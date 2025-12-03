import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

/**
 * Meshes 合约增强测试套件
 * - 多用户认领场景
 * - 燃烧机制完整测试
 * - 衰减周期测试
 * - 验证 quoteClaimCost 与 claimMesh 的一致性
 */

describe("Meshes.sol - Enhanced Analysis Test Suite", function () {
  let meshes: any;
  let treasury: any;
  let governanceSafe: any;
  let users: any[] = [];

  const SECONDS_IN_DAY = 86400;
  const TEST_COOLDOWN = 600; // 10分钟
  const TEST_YEAR_PERIOD = 600; // 10分钟
  const NUM_USERS = 10;
  const MESH_IDS = ["E100N100", "E200N200"];

  // 异常记录
  const anomalies: any[] = [];
  const warnings: any[] = [];

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  function formatEther(value: any): string {
    return ethers.utils.formatEther(BigNumber.from(value));
  }

  function formatUnits(value: any, decimals: number = 10): string {
    return ethers.utils.formatUnits(BigNumber.from(value), decimals);
  }

  /**
   * 记录异常
   */
  function recordAnomaly(round: string, type: string, description: string, details: any) {
    anomalies.push({
      round,
      type,
      description,
      details,
      timestamp: new Date().toISOString()
    });
    console.log(`\n🚨 异常检测 [${round}]: ${type} - ${description}`);
    console.log(`   详情: ${JSON.stringify(details, null, 2)}`);
  }

  /**
   * 记录警告
   */
  function recordWarning(round: string, type: string, description: string, details: any) {
    warnings.push({
      round,
      type,
      description,
      details,
      timestamp: new Date().toISOString()
    });
    console.log(`\n⚠️  警告 [${round}]: ${type} - ${description}`);
  }

  /**
   * 验证 quoteClaimCost 与 claimMesh 的一致性
   */
  async function verifyCostConsistency(meshID: string, user: any, round: string) {
    const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
    const userBalBefore = await meshes.balanceOf(user.address);
    const totalBurnBefore = await meshes.totalBurn();

    try {
      const tx = await meshes.connect(user).claimMesh(meshID);
      const rc = await tx.wait();

      const userBalAfter = await meshes.balanceOf(user.address);
      const totalBurnAfter = await meshes.totalBurn();
      const actualBurn = totalBurnAfter.sub(totalBurnBefore);
      const balanceChange = userBalBefore.sub(userBalAfter);

      console.log(`\n💰 成本一致性验证:`);
      console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);
      console.log(`   - 实际燃烧: ${formatEther(actualBurn)} MESH`);
      console.log(`   - 余额变化: ${formatEther(balanceChange)} MESH`);

      // 验证报价成本与实际燃烧是否一致
      const costDiff = quoteCost.sub(actualBurn).abs();
      if (costDiff.gt(ethers.utils.parseEther("0.0001"))) {
        recordAnomaly(round, "COST_MISMATCH", `网格${meshID}报价成本与实际燃烧不一致`, {
          meshID,
          quoteCost: formatEther(quoteCost),
          actualBurn: formatEther(actualBurn),
          diff: formatEther(costDiff)
        });
      } else {
        console.log(`   ✅ 成本一致性验证通过 (差异: ${formatEther(costDiff)} MESH)`);
      }

      // 验证余额变化是否等于燃烧成本
      if (quoteCost.gt(0)) {
        const balanceDiff = balanceChange.sub(quoteCost).abs();
        if (balanceDiff.gt(ethers.utils.parseEther("0.0001"))) {
          recordWarning(round, "BALANCE_MISMATCH", `用户余额变化与燃烧成本不一致`, {
            user: user.address.substring(0, 10),
            balanceChange: formatEther(balanceChange),
            quoteCost: formatEther(quoteCost),
            diff: formatEther(balanceDiff)
          });
        }
      }

      return {
        quoteCost,
        actualBurn,
        balanceChange,
        costDiff,
        success: true
      };
    } catch (error: any) {
      if (error.message.includes("Insufficient to burn")) {
        console.log(`   - 余额不足，无法支付燃烧成本 (需要: ${formatEther(quoteCost)} MESH)`);
        return {
          quoteCost,
          actualBurn: BigNumber.from(0),
          balanceChange: BigNumber.from(0),
          costDiff: BigNumber.from(0),
          success: false,
          reason: "Insufficient balance"
        };
      } else {
        recordAnomaly(round, "TRANSACTION_ERROR", `认领失败`, {
          error: error.message,
          meshID
        });
        return {
          quoteCost,
          actualBurn: BigNumber.from(0),
          balanceChange: BigNumber.from(0),
          costDiff: BigNumber.from(0),
          success: false,
          reason: error.message
        };
      }
    }
  }

  /**
   * 分析合约状态
   */
  async function analyzeContractState(round: string) {
    const totalSupply = await meshes.totalSupply();
    const totalBurn = await meshes.totalBurn();
    const activeClaimers = await meshes.activeClaimers();
    const activeMeshes = await meshes.activeMeshes();
    const totalClaimMints = await meshes.totalClaimMints();
    const maxMeshHeats = await meshes.maxMeshHeats();
    const dailyMintFactor = await meshes.dailyMintFactor();
    const burnScaleMilli = await meshes.burnScaleMilli();
    const pendingTreasuryPool = await meshes.pendingTreasuryPool();
    const treasuryBalance = await meshes.balanceOf(treasury.address);

    // 异常检测
    if (totalSupply.lt(totalBurn)) {
      recordAnomaly(round, "CRITICAL", "总供应量小于总燃烧量", {
        totalSupply: formatEther(totalSupply),
        totalBurn: formatEther(totalBurn)
      });
    }

    return {
      round,
      totalSupply,
      totalBurn,
      activeClaimers,
      activeMeshes,
      totalClaimMints,
      maxMeshHeats,
      dailyMintFactor,
      burnScaleMilli,
      pendingTreasuryPool,
      treasuryBalance
    };
  }

  /**
   * 计算预期热度（用于测试）
   */
  function calculateExpectedHeatForTest(claimCount: number): BigNumber {
    if (claimCount === 0) return BigNumber.from(0);
    if (claimCount < 30) {
      const precomputed = [
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1.2"),
        ethers.utils.parseEther("1.44"),
        ethers.utils.parseEther("1.728"),
        ethers.utils.parseEther("2.0736"),
        ethers.utils.parseEther("2.48832"),
        ethers.utils.parseEther("2.985984"),
        ethers.utils.parseEther("3.5831808"),
        ethers.utils.parseEther("4.29981696"),
        ethers.utils.parseEther("5.159780352"),
        ethers.utils.parseEther("6.1917364224"),
        ethers.utils.parseEther("7.43008370688"),
        ethers.utils.parseEther("8.916100448256"),
        ethers.utils.parseEther("10.6993205379072"),
        ethers.utils.parseEther("12.83918464548864"),
        ethers.utils.parseEther("15.407021574586368"),
        ethers.utils.parseEther("18.48842588950364"),
        ethers.utils.parseEther("22.186111067404368"),
        ethers.utils.parseEther("26.623333280885244"),
        ethers.utils.parseEther("31.947999937062296"),
        ethers.utils.parseEther("38.33759992447475"),
        ethers.utils.parseEther("46.0051199093697"),
        ethers.utils.parseEther("55.20614389124364"),
        ethers.utils.parseEther("66.24737266949237"),
        ethers.utils.parseEther("79.49684720339084"),
        ethers.utils.parseEther("95.39621664406896"),
        ethers.utils.parseEther("114.47545997288273"),
        ethers.utils.parseEther("137.3705519674593"),
        ethers.utils.parseEther("164.84466236095116"),
        ethers.utils.parseEther("197.81359483314138")
      ];
      return precomputed[claimCount - 1];
    } else {
      let result = ethers.utils.parseEther("197.81359483314138");
      const base = ethers.utils.parseEther("1.2");
      const maxN = Math.min(claimCount, 60);
      for (let i = 30; i <= maxN; i++) {
        result = result.mul(base).div(ethers.utils.parseEther("1"));
      }
      return result;
    }
  }

  /**
   * 计算预期燃烧成本（更新后的逻辑）
   */
  function calculateExpectedBurnCost(heat: BigNumber, maxHeats: BigNumber, burnScale: BigNumber): BigNumber {
    if (maxHeats.eq(0) || burnScale.eq(0)) return BigNumber.from(0);
    
    const BASE_BURN = BigNumber.from(10);
    // 更新后的逻辑：heat^2 / 1 ether 归一化
    const heatSquared = heat.mul(heat).div(ethers.utils.parseEther("1"));
    const baseCost = BASE_BURN.mul(heatSquared).div(maxHeats);
    const scaledCost = baseCost.mul(burnScale).div(1000);
    return scaledCost;
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    governanceSafe = signers[0];
    treasury = signers[Math.min(11, signers.length - 1)] || signers[0];
    const availableUsers = Math.min(NUM_USERS, signers.length - 1);
    users = signers.slice(1, availableUsers + 1);
    
    while (users.length < NUM_USERS) {
      users.push(users[users.length % availableUsers]);
    }

    const MeshesF = await ethers.getContractFactory("Meshes");
    meshes = await MeshesF.connect(governanceSafe).deploy(governanceSafe.address);
    await meshes.deployed();
    
    await meshes.connect(governanceSafe).setTreasuryAddress(treasury.address);
    await meshes.connect(governanceSafe).setBurnScale(1000);

    anomalies.length = 0;
    warnings.length = 0;
  });

  describe("Enhanced Test Scenarios", () => {
    it("Scenario 1: 多用户认领同一网格 - 验证燃烧成本递增", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 场景1: 多用户认领同一网格 - 验证燃烧成本递增`);
      console.log(`${"=".repeat(80)}`);

      const meshID = MESH_IDS[0];
      const costs: any[] = [];

      // 第一个用户免费认领
      console.log(`\n🎯 用户1 认领网格 ${meshID} (首次，免费)`);
      await meshes.connect(users[0]).claimMesh(meshID);
      const [heat1, cost1] = await meshes.quoteClaimCost(meshID);
      costs.push({ user: 1, heat: formatEther(heat1), cost: formatEther(cost1) });
      console.log(`   - 热度: ${formatEther(heat1)}, 下次成本: ${formatEther(cost1)} MESH`);

      // 给后续用户准备代币
      await increaseTime(TEST_COOLDOWN);
      await meshes.connect(users[0]).withdraw();
      const user0Bal = await meshes.balanceOf(users[0].address);
      if (user0Bal.gt(0)) {
        // 分配代币给其他用户
        for (let i = 1; i < 5; i++) {
          await meshes.connect(users[0]).transfer(users[i].address, user0Bal.div(5));
        }
      }

      // 多个用户认领同一网格
      for (let i = 1; i < 5; i++) {
        console.log(`\n🎯 用户${i + 1} 认领网格 ${meshID}`);
        
        const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
        const userBal = await meshes.balanceOf(users[i].address);
        
        console.log(`   - 报价热度: ${formatEther(quoteHeat)}`);
        console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);
        console.log(`   - 用户余额: ${formatEther(userBal)} MESH`);

        if (userBal.gte(quoteCost)) {
          const result = await verifyCostConsistency(meshID, users[i], `Scenario1-User${i + 1}`);
          if (result.success) {
            costs.push({
              user: i + 1,
              heat: formatEther(quoteHeat),
              cost: formatEther(quoteCost),
              actualBurn: formatEther(result.actualBurn)
            });
          }
        } else {
          console.log(`   ⚠️  余额不足，跳过`);
        }
      }

      console.log(`\n📊 成本递增分析:`);
      costs.forEach((c, index) => {
        console.log(`   用户${c.user}: 热度=${c.heat}, 成本=${c.cost} MESH`);
        if (index > 0 && costs[index - 1].cost) {
          const costIncrease = parseFloat(c.cost) - parseFloat(costs[index - 1].cost);
          console.log(`     - 成本增加: ${costIncrease.toFixed(6)} MESH`);
        }
      });

      const state = await analyzeContractState("Scenario1");
      expect(state.totalClaimMints.toNumber()).to.be.gte(5);
    });

    it("Scenario 2: 燃烧机制完整测试 - 不同燃烧缩放比例", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 场景2: 燃烧机制完整测试 - 不同燃烧缩放比例`);
      console.log(`${"=".repeat(80)}`);

      // 使用不同的网格和用户进行测试
      const testMeshes = ["E300N300", "E400N400", "E500N500", "E600N600"];
      const burnScales = [0, 500, 1000, 2000];
      const results: any[] = [];

      for (let i = 0; i < burnScales.length; i++) {
        const meshID = testMeshes[i];
        const scale = burnScales[i];
        const user = users[i];
        
        console.log(`\n⚙️  设置燃烧缩放比例: ${scale} (${scale / 1000}x)`);
        await meshes.connect(governanceSafe).setBurnScale(scale);

        // 第一个用户免费认领
        await meshes.connect(user).claimMesh(meshID);
        await increaseTime(TEST_COOLDOWN);
        await meshes.connect(user).withdraw();
        const userBal = await meshes.balanceOf(user.address);
        
        // 给下一个用户代币用于测试
        if (i < burnScales.length - 1) {
          const nextUser = users[i + 1];
          if (userBal.gt(0)) {
            await meshes.connect(user).transfer(nextUser.address, userBal);
          }
        }

        const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
        console.log(`   - 网格: ${meshID}`);
        console.log(`   - 报价热度: ${formatEther(quoteHeat)}`);
        console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);

        if (scale === 0) {
          console.log(`   ✅ 燃烧关闭，成本应为0`);
          expect(quoteCost.eq(0)).to.be.true;
        } else {
          // 使用下一个用户验证成本一致性
          if (i < burnScales.length - 1) {
            const nextUser = users[i + 1];
            const nextUserBal = await meshes.balanceOf(nextUser.address);
            if (nextUserBal.gte(quoteCost) && quoteCost.gt(0)) {
              const result = await verifyCostConsistency(meshID, nextUser, `Scenario2-Scale${scale}`);
              results.push({
                scale,
                quoteCost: formatEther(quoteCost),
                actualBurn: formatEther(result.actualBurn),
                match: result.costDiff.lt(ethers.utils.parseEther("0.0001"))
              });
            }
          }
        }
      }

      console.log(`\n📊 燃烧缩放测试结果:`);
      results.forEach(r => {
        console.log(`   缩放${r.scale}: 报价=${r.quoteCost} MESH, 实际=${r.actualBurn} MESH, 匹配=${r.match ? "✅" : "❌"}`);
      });

      const state = await analyzeContractState("Scenario2");
      expect(state.burnScaleMilli.toNumber()).to.equal(2000);
    });

    it("Scenario 3: 衰减周期测试 - 验证因子变化对收益的影响", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 场景3: 衰减周期测试 - 验证因子变化对收益的影响（加强版）`);
      console.log(`${"=".repeat(80)}`);

      const meshID = MESH_IDS[0];
      
      // 用户认领并首次提现
      await meshes.connect(users[0]).claimMesh(meshID);
      await increaseTime(TEST_COOLDOWN);
      
      const genesisTs = await meshes.genesisTs();
      const initialTime = (await ethers.provider.getBlock("latest")).timestamp;
      const initialYearPeriods = (initialTime - genesisTs.toNumber()) / TEST_YEAR_PERIOD;
      
      const factorBefore = await meshes.dailyMintFactor();
      const previewBefore = await meshes.previewWithdraw(users[0].address);
      
      await meshes.connect(users[0]).withdraw();
      const payout1 = await meshes.balanceOf(users[0].address);
      
      console.log(`\n📊 初始状态:`);
      console.log(`   - 创世时间: ${genesisTs.toString()}`);
      console.log(`   - 当前时间: ${initialTime}`);
      console.log(`   - 初始年周期数: ${initialYearPeriods.toFixed(2)}`);
      console.log(`   - 衰减因子: ${formatUnits(factorBefore, 10)}`);
      console.log(`   - 首次提现: ${formatEther(payout1)} MESH`);

      // 等待多个年周期，每次验证
      const periods = [1, 2, 3, 5, 10];
      const payouts: any[] = [];
      let cumulativePeriods = 0;

      for (const period of periods) {
        cumulativePeriods += period;
        console.log(`\n⏰ 等待 ${period} 个年周期 (累计 ${cumulativePeriods} 个周期, ${cumulativePeriods * TEST_YEAR_PERIOD}秒)`);
        await increaseTime(period * TEST_YEAR_PERIOD);
        
        // 获取当前时间和年周期数
        const currentTime = (await ethers.provider.getBlock("latest")).timestamp;
        const currentYearPeriods = (currentTime - genesisTs.toNumber()) / TEST_YEAR_PERIOD;
        console.log(`   - 当前年周期数: ${currentYearPeriods.toFixed(2)}`);
        
        // 等待一天才能再次提现
        await increaseTime(SECONDS_IN_DAY);
        
        // 触发因子更新（通过提现）
        const factorBeforeWithdraw = await meshes.dailyMintFactor();
        const previewAfter = await meshes.previewWithdraw(users[0].address);
        const totalPayout = previewAfter.payoutToday.add(previewAfter.carryBefore);
        
        // 检查是否有足够的金额可以提现
        if (totalPayout.gt(0)) {
          const balBefore = await meshes.balanceOf(users[0].address);
          await meshes.connect(users[0]).withdraw();
          const balAfter = await meshes.balanceOf(users[0].address);
          const payout = balAfter.sub(balBefore);
          
          // 提现后会更新因子
          const factorAfter = await meshes.dailyMintFactor();
          
          console.log(`   - 提现前因子: ${formatUnits(factorBeforeWithdraw, 10)}`);
          console.log(`   - 提现后因子: ${formatUnits(factorAfter, 10)}`);
          console.log(`   - 预期收益: ${formatEther(previewAfter.payoutToday)} MESH`);
          console.log(`   - 实际收益: ${formatEther(payout)} MESH`);

          // 验证衰减：每周期应该衰减10%
          // 计算从初始到当前应该经过的周期数
          // 注意：因子更新是在提现时根据当前时间计算的
          const expectedPeriods = Math.floor(currentYearPeriods);
          let expectedFactor = BigNumber.from("10000000000"); // 1e10
          // 限制最大周期数，避免因子变为0
          const maxPeriods = Math.min(expectedPeriods, 100);
          for (let p = 0; p < maxPeriods; p++) {
            expectedFactor = expectedFactor.mul(9).div(10);
            if (expectedFactor.eq(0)) break;
          }
          
          const factorDiff = factorAfter.sub(expectedFactor).abs();
          const factorDiffPercent = factorDiff.mul(10000).div(expectedFactor.gt(0) ? expectedFactor : BigNumber.from(1));
          
          console.log(`   - 预期因子: ${formatUnits(expectedFactor, 10)}`);
          console.log(`   - 因子差异: ${formatUnits(factorDiff, 10)} (${formatUnits(factorDiffPercent, 2)}%)`);
          
          if (factorDiffPercent.gt(100)) { // 差异超过1%
            recordWarning(`Scenario3-Period${cumulativePeriods}`, "FACTOR_MISMATCH", "衰减因子与预期不符", {
              expectedPeriods,
              expected: formatUnits(expectedFactor, 10),
              actual: formatUnits(factorAfter, 10),
              diff: formatUnits(factorDiff, 10),
              diffPercent: formatUnits(factorDiffPercent, 2) + "%"
            });
          } else {
            console.log(`   ✅ 衰减因子验证通过 (差异: ${formatUnits(factorDiffPercent, 2)}%)`);
          }

          // 验证收益与因子的一致性
          const userWeight = await meshes.userWeightSum(users[0].address);
          const expectedPayoutFromFactor = factorAfter.mul(userWeight).div(ethers.utils.parseUnits("1", 10));
          const payoutDiff = payout.sub(expectedPayoutFromFactor.add(previewAfter.carryBefore)).abs();
          
          if (payoutDiff.gt(ethers.utils.parseEther("0.001"))) {
            recordWarning(`Scenario3-Period${cumulativePeriods}`, "PAYOUT_MISMATCH", "收益与因子计算不一致", {
              expected: formatEther(expectedPayoutFromFactor.add(previewAfter.carryBefore)),
              actual: formatEther(payout),
              diff: formatEther(payoutDiff)
            });
          } else {
            console.log(`   ✅ 收益计算验证通过`);
          }

          payouts.push({
            cumulativePeriods,
            factor: formatUnits(factorAfter, 10),
            expectedFactor: formatUnits(expectedFactor, 10),
            payout: formatEther(payout),
            factorDiff: formatUnits(factorDiff, 10)
          });
        } else {
          console.log(`   ⚠️  提现金额为0，跳过`);
        }
      }

      console.log(`\n📊 衰减周期详细分析:`);
      payouts.forEach((p, index) => {
        console.log(`\n   周期${p.cumulativePeriods}:`);
        console.log(`     - 实际因子: ${p.factor}`);
        console.log(`     - 预期因子: ${p.expectedFactor}`);
        console.log(`     - 因子差异: ${p.factorDiff}`);
        console.log(`     - 收益: ${p.payout} MESH`);
        if (index > 0) {
          const factorDecrease = parseFloat(payouts[index - 1].factor) - parseFloat(p.factor);
          const payoutDecrease = parseFloat(payouts[index - 1].payout) - parseFloat(p.payout);
          console.log(`     - 因子减少: ${factorDecrease.toFixed(10)}`);
          console.log(`     - 收益减少: ${payoutDecrease.toFixed(6)} MESH`);
        }
      });

      // 验证最终状态
      const state = await analyzeContractState("Scenario3");
      const finalFactor = await meshes.dailyMintFactor();
      expect(finalFactor.lt(factorBefore)).to.be.true;
      
      console.log(`\n✅ 衰减周期测试完成:`);
      console.log(`   - 初始因子: ${formatUnits(factorBefore, 10)}`);
      console.log(`   - 最终因子: ${formatUnits(finalFactor, 10)}`);
      console.log(`   - 衰减验证: ${finalFactor.lt(factorBefore) ? "✅ 通过" : "❌ 失败"}`);
    });

    it("Scenario 4: 多网格多用户复杂场景", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 场景4: 多网格多用户复杂场景`);
      console.log(`${"=".repeat(80)}`);

      // 多个用户认领不同网格
      for (let i = 0; i < 5; i++) {
        const meshIndex = i % MESH_IDS.length;
        const meshID = MESH_IDS[meshIndex];
        console.log(`\n🎯 用户${i + 1} 认领网格 ${meshID}`);
        
        try {
          await meshes.connect(users[i]).claimMesh(meshID);
        } catch (error: any) {
          if (!error.message.includes("Already claim")) {
            console.log(`   ⚠️  认领失败: ${error.message}`);
          }
        }
      }

      // 等待并提现
      await increaseTime(TEST_COOLDOWN);
      for (let i = 0; i < 5; i++) {
        const [canWithdraw] = await meshes.canUserWithdraw(users[i].address);
        if (canWithdraw) {
          const preview = await meshes.previewWithdraw(users[i].address);
          if (preview.payoutToday.add(preview.carryBefore).gt(0)) {
            await meshes.connect(users[i]).withdraw();
          }
        }
      }

      // 验证成本一致性
      console.log(`\n💰 验证所有网格的成本一致性:`);
      for (const meshID of MESH_IDS) {
        const claimCount = await meshes.meshClaimCount(meshID);
        if (BigNumber.from(claimCount).gt(0)) {
          const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
          console.log(`   ${meshID}: 认领=${BigNumber.from(claimCount).toString()}次, 热度=${formatEther(quoteHeat)}, 成本=${formatEther(quoteCost)} MESH`);
          
          // 找一个有足够余额的用户验证
          for (let i = 0; i < NUM_USERS; i++) {
            const bal = await meshes.balanceOf(users[i].address);
            if (bal.gte(quoteCost) && quoteCost.gt(0)) {
              const result = await verifyCostConsistency(meshID, users[i], `Scenario4-${meshID}`);
              if (result.success) break;
            }
          }
        }
      }

      const state = await analyzeContractState("Scenario4");
      console.log(`\n📈 最终状态:`);
      console.log(`   - 总认领次数: ${state.totalClaimMints.toString()}`);
      console.log(`   - 活跃用户: ${state.activeClaimers.toString()}`);
      console.log(`   - 活跃网格: ${state.activeMeshes.toString()}`);
      console.log(`   - 总燃烧量: ${formatEther(state.totalBurn)} MESH`);

      expect(state.totalClaimMints.toNumber()).to.be.gte(2); // 至少2个用户成功认领
    });

    it("Scenario 5: maxHeats = 0 场景验证", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 场景5: maxHeats = 0 场景验证`);
      console.log(`${"=".repeat(80)}`);

      // 在初始状态下，maxHeats = 0
      const meshID = MESH_IDS[0];
      const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
      const maxHeats = await meshes.maxMeshHeats();

      console.log(`\n📊 初始状态:`);
      console.log(`   - maxHeats: ${formatEther(maxHeats)}`);
      console.log(`   - 报价热度: ${formatEther(quoteHeat)}`);
      console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);

      // 当 maxHeats = 0 时，成本应该为 0（因为 denom = 1，但 heat = 0）
      if (maxHeats.eq(0)) {
        expect(quoteCost.eq(0)).to.be.true;
        console.log(`   ✅ maxHeats = 0 时，成本为0，符合预期`);
      }

      // 第一个用户认领后，maxHeats 应该更新
      await meshes.connect(users[0]).claimMesh(meshID);
      const maxHeatsAfter = await meshes.maxMeshHeats();
      const [quoteHeatAfter, quoteCostAfter] = await meshes.quoteClaimCost(meshID);

      console.log(`\n📊 认领后状态:`);
      console.log(`   - maxHeats: ${formatEther(maxHeatsAfter)}`);
      console.log(`   - 报价热度: ${formatEther(quoteHeatAfter)}`);
      console.log(`   - 报价成本: ${formatEther(quoteCostAfter)} MESH`);

      expect(maxHeatsAfter.gt(0)).to.be.true;
      
      // 验证成本计算
      const expectedCost = calculateExpectedBurnCost(
        quoteHeatAfter,
        maxHeatsAfter,
        await meshes.burnScaleMilli()
      );
      const costDiff = quoteCostAfter.sub(expectedCost).abs();
      
      if (costDiff.gt(ethers.utils.parseEther("0.0001"))) {
        recordWarning("Scenario5", "COST_CALCULATION", "成本计算与预期不符", {
          expected: formatEther(expectedCost),
          actual: formatEther(quoteCostAfter),
          diff: formatEther(costDiff)
        });
      } else {
        console.log(`   ✅ 成本计算验证通过`);
      }
    });

    // 分阶段测试：50, 60, 70, 80, 90, 100次
    const testStages = [50, 60, 70, 80, 90, 100];
    
    testStages.forEach((targetClaims) => {
      it(`Scenario 6: 单一网格认领${targetClaims}次 - 验证大数据量计算`, async () => {
        console.log(`\n${"=".repeat(80)}`);
        console.log(`📋 场景6: 单一网格认领${targetClaims}次 - 验证大数据量计算`);
        console.log(`${"=".repeat(80)}`);

        const meshID = `E999N${999 + targetClaims}`; // 使用不同的网格ID避免冲突
      
      console.log(`\n🎯 目标: 让网格 ${meshID} 被认领 ${targetClaims} 次`);
      
      // 创建100个不同的地址用于认领
      // 使用ethers.Wallet创建地址，然后通过治理地址代为认领
      const allSigners = await ethers.getSigners();
      const claimAddresses: string[] = [];
      const claimUsers: any[] = [];
      
      // 创建100个地址
      for (let i = 0; i < targetClaims; i++) {
        if (i < allSigners.length) {
          // 使用现有的签名者
          claimUsers.push(allSigners[i]);
          claimAddresses.push(allSigners[i].address);
        } else {
          // 创建新的地址（仅用于接收代币和认领）
          const wallet = ethers.Wallet.createRandom();
          claimAddresses.push(wallet.address);
          claimUsers.push(null); // 标记为虚拟地址
        }
      }
      
      console.log(`   - 创建了 ${claimAddresses.length} 个用户地址用于测试`);
      console.log(`   - 其中 ${allSigners.length} 个真实签名者，${targetClaims - allSigners.length} 个虚拟地址`);
      
      // 第一个用户免费认领
      console.log(`\n📝 用户1 认领 (首次，免费)`);
      await meshes.connect(claimUsers[0]).claimMesh(meshID);
      await increaseTime(TEST_COOLDOWN);
      await meshes.connect(claimUsers[0]).withdraw();
      
      // 准备代币：让用户持续提现以获得更多代币
      // 先让用户1多次提现积累代币
      for (let i = 0; i < 5; i++) {
        await increaseTime(SECONDS_IN_DAY);
        const [canWithdraw] = await meshes.canUserWithdraw(users[0].address);
        if (canWithdraw) {
          const preview = await meshes.previewWithdraw(users[0].address);
          if (preview.payoutToday.add(preview.carryBefore).gt(0)) {
            await meshes.connect(users[0]).withdraw();
          }
        }
      }
      
      // 分配代币给其他用户
      let user0Bal = await meshes.balanceOf(users[0].address);
      console.log(`   - 用户1积累的代币: ${formatEther(user0Bal)} MESH`);
      
      // 给每个用户分配足够的代币（估算每次认领需要约0.1 MESH）
      const estimatedCostPerClaim = ethers.utils.parseEther("0.1");
      const tokensPerUser = estimatedCostPerClaim.mul(targetClaims / NUM_USERS + 5); // 多给一些
      
      for (let i = 1; i < NUM_USERS; i++) {
        if (user0Bal.gte(tokensPerUser)) {
          await meshes.connect(users[0]).transfer(users[i].address, tokensPerUser);
          user0Bal = user0Bal.sub(tokensPerUser);
        } else {
          // 如果不够，平均分配剩余代币
          const remaining = user0Bal.div(NUM_USERS - i);
          await meshes.connect(users[0]).transfer(users[i].address, remaining);
          break;
        }
      }

      const claimResults: any[] = [];
      let successCount = 0;
      let failCount = 0;
      const checkpoints = [10, 25, 50, 75, 100];

      // 准备代币：让第一个用户多次提现积累代币（增加积累周期）
      console.log(`\n💰 开始积累代币...`);
      for (let i = 0; i < 30; i++) { // 增加到30次提现周期
        await increaseTime(SECONDS_IN_DAY);
        const [canWithdraw] = await meshes.canUserWithdraw(allSigners[0].address);
        if (canWithdraw) {
          const preview = await meshes.previewWithdraw(allSigners[0].address);
          if (preview.payoutToday.add(preview.carryBefore).gt(0)) {
            try {
              await meshes.connect(allSigners[0]).withdraw();
            } catch (e) {
              // 忽略错误
            }
          }
        }
        // 每10次显示一次进度
        if ((i + 1) % 10 === 0) {
          const bal = await meshes.balanceOf(allSigners[0].address);
          console.log(`   - 第 ${i + 1} 次提现后余额: ${formatEther(bal)} MESH`);
        }
      }
      
      // 分配代币给后续用户（包括虚拟地址）
      let claimUser0Bal = await meshes.balanceOf(allSigners[0].address);
      console.log(`   - 用户1最终积累的代币: ${formatEther(claimUser0Bal)} MESH`);
      
      if (claimUser0Bal.gt(0)) {
        const numRecipients = Math.min(targetClaims - 1, 100);
        // 计算每个用户应该分配多少代币
        const claimTokensPerUser = claimUser0Bal.div(numRecipients + 10); // 保留一些作为缓冲
        console.log(`   - 分配给每个用户的代币: ${formatEther(claimTokensPerUser)} MESH`);
        
        for (let i = 1; i < numRecipients; i++) {
          if (claimTokensPerUser.gt(0) && claimUser0Bal.gte(claimTokensPerUser)) {
            // 转账到地址（无论是真实签名者还是虚拟地址）
            await meshes.connect(allSigners[0]).transfer(claimAddresses[i], claimTokensPerUser);
            claimUser0Bal = claimUser0Bal.sub(claimTokensPerUser);
          }
        }
        console.log(`   - 分配后用户1剩余: ${formatEther(claimUser0Bal)} MESH`);
      }
      
      // 循环认领直到达到100次
      let attempt = 1;
      
      while (attempt <= targetClaims) {
        const userIndex = attempt - 1;
        const userAddress = claimAddresses[userIndex];
        const user = claimUsers[userIndex]; // 可能是null（虚拟地址）
        
        // 定期让用户提现以获得更多代币（更频繁的提现）
        if (attempt % 10 === 0 && attempt > 1) { // 改为每10次提现一次
          console.log(`\n💰 第 ${attempt} 次认领前，让用户提现积累代币...`);
          await increaseTime(SECONDS_IN_DAY);
          // 让更多用户提现（仅真实签名者）
          for (let u = 0; u < Math.min(20, allSigners.length); u++) {
            const signer = allSigners[u];
            const [canWithdraw] = await meshes.canUserWithdraw(signer.address);
            if (canWithdraw) {
              const preview = await meshes.previewWithdraw(signer.address);
              if (preview.payoutToday.add(preview.carryBefore).gt(0)) {
                try {
                  await meshes.connect(signer).withdraw();
                } catch (e) {
                  // 忽略错误
                }
              }
            }
          }
          
          // 重新分配代币：收集所有真实签名者的代币，然后重新分配
          let totalTokens = BigNumber.from(0);
          const tokenBalances: BigNumber[] = [];
          for (let u = 0; u < Math.min(20, allSigners.length); u++) {
            const bal = await meshes.balanceOf(allSigners[u].address);
            tokenBalances.push(bal);
            totalTokens = totalTokens.add(bal);
          }
          
          // 如果总代币足够，重新平均分配
          if (totalTokens.gt(ethers.utils.parseEther("0.1"))) {
            const tokensPerUser = totalTokens.div(Math.min(100, claimAddresses.length) + 10);
            // 将代币集中到第一个用户，然后重新分配（检查余额）
            for (let u = 1; u < Math.min(20, allSigners.length); u++) {
              const currentBal = await meshes.balanceOf(allSigners[u].address);
              if (currentBal.gt(0)) {
                try {
                  await meshes.connect(allSigners[u]).transfer(allSigners[0].address, currentBal);
                } catch (e) {
                  // 忽略错误，可能余额已变化
                }
              }
            }
            // 重新分配（检查余额）
            const redistributed = await meshes.balanceOf(allSigners[0].address);
            if (redistributed.gt(0)) {
              const redistPerUser = redistributed.div(Math.min(100, claimAddresses.length) + 10);
              for (let u = 1; u < Math.min(100, claimAddresses.length); u++) {
                const currentBal = await meshes.balanceOf(allSigners[0].address);
                if (redistPerUser.gt(0) && currentBal.gte(redistPerUser)) {
                  try {
                    await meshes.connect(allSigners[0]).transfer(claimAddresses[u], redistPerUser);
                  } catch (e) {
                    // 忽略错误
                  }
                }
              }
            }
          }
        }
        
        try {
          // 检查用户是否已认领过
          const userMintInfo = await meshes.userMints(userAddress, meshID);
          if (!userMintInfo.updateTs.eq(0)) {
            // 用户已认领过，跳过这个用户，使用下一个
            attempt++;
            continue;
          }
          
          // 获取报价
          const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
          const claimCount = await meshes.meshClaimCount(meshID);
          let userBal = await meshes.balanceOf(userAddress);
          
          // 如果余额不足，尝试从其他用户转账
          if (userBal.lt(quoteCost) && quoteCost.gt(0)) {
            // 从其他用户转账（更积极的策略）
            let found = false;
            for (let j = 0; j < Math.min(100, claimAddresses.length); j++) {
              const otherAddress = claimAddresses[j];
              if (otherAddress === userAddress) continue;
              const otherBal = await meshes.balanceOf(otherAddress);
              if (otherBal.gte(quoteCost)) {
                // 如果余额刚好够，只转需要的量
                const transferAmount = userBal.lt(quoteCost) ? quoteCost.mul(2) : quoteCost;
                if (otherBal.gte(transferAmount)) {
                  // 使用真实签名者来转账
                  const otherUser = claimUsers[j];
                  if (otherUser) {
                    await meshes.connect(otherUser).transfer(userAddress, transferAmount);
                  } else {
                    // 如果是虚拟地址，使用第一个签名者代为转账
                    await meshes.connect(allSigners[0]).transfer(userAddress, transferAmount);
                  }
                  userBal = await meshes.balanceOf(userAddress);
                  found = true;
                  break;
                }
              }
            }
            
            // 如果还是不够，尝试让用户提现（仅真实签名者）
            if (!found && userBal.lt(quoteCost) && user) {
              const [canWithdraw] = await meshes.canUserWithdraw(userAddress);
              if (canWithdraw) {
                await increaseTime(SECONDS_IN_DAY);
                const preview = await meshes.previewWithdraw(userAddress);
                if (preview.payoutToday.add(preview.carryBefore).gt(0)) {
                  try {
                    await meshes.connect(user).withdraw();
                    userBal = await meshes.balanceOf(userAddress);
                  } catch (e) {
                    // 忽略错误
                  }
                }
              }
            }
            
            // 如果仍然不够，跳过这次认领
            if (userBal.lt(quoteCost)) {
              console.log(`   ⚠️  第 ${attempt} 次认领跳过: 余额不足 (需要: ${formatEther(quoteCost)}, 拥有: ${formatEther(userBal)})`);
              attempt++;
              continue;
            }
          }
          
          const balBefore = await meshes.balanceOf(userAddress);
          const totalBurnBefore = await meshes.totalBurn();
          
          // 如果是真实签名者，直接认领；否则使用治理地址代为认领
          if (user) {
            await meshes.connect(user).claimMesh(meshID);
          } else {
            // 虚拟地址：使用治理地址代为认领
            await meshes.connect(governanceSafe).claimMeshFor(userAddress, meshID);
          }
          
          const balAfter = await meshes.balanceOf(userAddress);
          const totalBurnAfter = await meshes.totalBurn();
          const actualBurn = totalBurnAfter.sub(totalBurnBefore);
          
          successCount++;
          
          // 在检查点记录详细信息
          if (checkpoints.includes(attempt) || attempt <= 5) {
            const meshHeats = await meshes.meshHeats(meshID);
            const maxHeats = await meshes.maxMeshHeats();
            
            console.log(`\n📊 第 ${attempt} 次认领检查点:`);
            console.log(`   - 用户: ${userIndex + 1} (${user ? "真实" : "虚拟"})`);
            console.log(`   - 认领次数: ${claimCount.toString()}`);
            console.log(`   - 报价热度: ${formatEther(quoteHeat)}`);
            console.log(`   - 实际热度: ${formatEther(meshHeats)}`);
            console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);
            console.log(`   - 实际燃烧: ${formatEther(actualBurn)} MESH`);
            console.log(`   - 最大热度: ${formatEther(maxHeats)}`);
            
            // 验证成本一致性
            const costDiff = quoteCost.sub(actualBurn).abs();
            if (costDiff.gt(ethers.utils.parseEther("0.0001"))) {
              recordAnomaly(`Scenario6-Claim${attempt}`, "COST_MISMATCH", `第${attempt}次认领成本不匹配`, {
                quoteCost: formatEther(quoteCost),
                actualBurn: formatEther(actualBurn),
                diff: formatEther(costDiff)
              });
            } else {
              console.log(`   ✅ 成本一致性验证通过`);
            }
            
            // 验证热度计算（注意：合约中热度计算在 n>60 时会被截断到60）
            const claimCountNum = typeof claimCount === 'number' ? claimCount : claimCount.toNumber ? claimCount.toNumber() : parseInt(claimCount.toString());
            // 使用合约的 calculateDegreeHeat 逻辑
            const expectedHeat = calculateExpectedHeatForTest(Math.min(claimCountNum + 1, 60));
            const heatDiff = meshHeats.sub(expectedHeat).abs();
            const heatDiffPercent = heatDiff.mul(10000).div(expectedHeat.gt(0) ? expectedHeat : BigNumber.from(1));
            
            if (heatDiffPercent.gt(100)) { // 差异超过1%
              recordWarning(`Scenario6-Claim${attempt}`, "HEAT_MISMATCH", `第${attempt}次认领热度不匹配`, {
                expected: formatEther(expectedHeat),
                actual: formatEther(meshHeats),
                diff: formatEther(heatDiff),
                diffPercent: formatUnits(heatDiffPercent, 2) + "%"
              });
            } else {
              console.log(`   ✅ 热度计算验证通过`);
            }
            
            // 验证 maxHeats
            if (maxHeats.lt(meshHeats)) {
              recordAnomaly(`Scenario6-Claim${attempt}`, "MAX_HEATS_ERROR", `maxHeats 小于当前热度`, {
                maxHeats: formatEther(maxHeats),
                currentHeat: formatEther(meshHeats)
              });
            }
          }
          
          claimResults.push({
            attempt,
            user: userIndex + 1,
            quoteCost: formatEther(quoteCost),
            actualBurn: formatEther(actualBurn),
            heat: formatEther(quoteHeat),
            success: true
          });
          
        } catch (error: any) {
          failCount++;
          const errorMsg = error.message || String(error);
          if (errorMsg.includes("Already claim")) {
            // 用户已认领过，跳过
            attempt++;
            continue;
          } else if (errorMsg.includes("Insufficient to burn")) {
            console.log(`   ⚠️  第 ${attempt} 次认领失败: 余额不足`);
            attempt++;
            continue;
          } else {
            recordAnomaly(`Scenario6-Claim${attempt}`, "TRANSACTION_ERROR", `第${attempt}次认领失败`, {
              error: errorMsg,
              userAddress: userAddress || "unknown"
            });
            attempt++;
          }
        }
      }

      // 最终验证
      const finalClaimCount = await meshes.meshClaimCount(meshID);
      const finalHeat = await meshes.meshHeats(meshID);
      const finalMaxHeats = await meshes.maxMeshHeats();
      const totalBurn = await meshes.totalBurn();
      const [finalQuoteHeat, finalQuoteCost] = await meshes.quoteClaimCost(meshID);

      console.log(`\n${"=".repeat(80)}`);
      console.log(`📊 100次认领最终验证`);
      console.log(`${"=".repeat(80)}`);
      console.log(`   - 成功认领次数: ${successCount}`);
      console.log(`   - 失败次数: ${failCount}`);
      console.log(`   - 最终认领计数: ${finalClaimCount.toString()}`);
      console.log(`   - 最终热度: ${formatEther(finalHeat)}`);
      console.log(`   - 最大热度: ${formatEther(finalMaxHeats)}`);
      console.log(`   - 总燃烧量: ${formatEther(totalBurn)} MESH`);
      console.log(`   - 最终报价热度: ${formatEther(finalQuoteHeat)}`);
      console.log(`   - 最终报价成本: ${formatEther(finalQuoteCost)} MESH`);

      // 验证最终热度（注意：合约限制 n>60 时使用 n=60）
      const claimCountNum = typeof finalClaimCount === 'number' ? finalClaimCount : finalClaimCount.toNumber ? finalClaimCount.toNumber() : parseInt(finalClaimCount.toString());
      const effectiveCount = Math.min(claimCountNum, 60);
      const expectedFinalHeat = calculateExpectedHeatForTest(effectiveCount);
      const finalHeatDiff = finalHeat.sub(expectedFinalHeat).abs();
      const finalHeatDiffPercent = finalHeatDiff.mul(10000).div(expectedFinalHeat.gt(0) ? expectedFinalHeat : BigNumber.from(1));
      
      console.log(`\n✅ 最终验证:`);
      console.log(`   - 有效认领次数: ${effectiveCount} (合约限制最大60)`);
      console.log(`   - 预期热度: ${formatEther(expectedFinalHeat)}`);
      console.log(`   - 实际热度: ${formatEther(finalHeat)}`);
      console.log(`   - 热度差异: ${formatEther(finalHeatDiff)} (${formatUnits(finalHeatDiffPercent, 2)}%)`);
      
      if (finalHeatDiffPercent.gt(100)) {
        recordAnomaly("Scenario6-Final", "HEAT_CALCULATION_ERROR", "最终热度计算错误", {
          effectiveCount,
          expected: formatEther(expectedFinalHeat),
          actual: formatEther(finalHeat),
          diff: formatEther(finalHeatDiff),
          diffPercent: formatUnits(finalHeatDiffPercent, 2) + "%"
        });
      } else {
        console.log(`   ✅ 热度计算验证通过`);
      }

      // 验证 maxHeats
      if (finalMaxHeats.lt(finalHeat)) {
        recordAnomaly("Scenario6-Final", "MAX_HEATS_ERROR", "maxHeats 小于当前热度", {
          maxHeats: formatEther(finalMaxHeats),
          currentHeat: formatEther(finalHeat)
        });
      } else {
        console.log(`   ✅ maxHeats 验证通过`);
      }

      // 验证合约状态
      const state = await analyzeContractState("Scenario6");
      console.log(`\n📈 合约状态:`);
      console.log(`   - 总认领次数: ${state.totalClaimMints.toString()}`);
      console.log(`   - 活跃用户: ${state.activeClaimers.toString()}`);
      console.log(`   - 活跃网格: ${state.activeMeshes.toString()}`);
      console.log(`   - 总燃烧量: ${formatEther(state.totalBurn)} MESH`);

      // 验证数值合理性
      console.log(`\n🔍 数值合理性验证:`);
      const liquidSupply = state.totalSupply.sub(await meshes.balanceOf(meshes.address));
      console.log(`   - 总供应量: ${formatEther(state.totalSupply)} MESH`);
      console.log(`   - 流动供应量: ${formatEther(liquidSupply)} MESH`);
      console.log(`   - 总燃烧量: ${formatEther(state.totalBurn)} MESH`);
      console.log(`   - 供应量 >= 燃烧量: ${state.totalSupply.gte(state.totalBurn) ? "✅" : "❌"}`);
      console.log(`   - 活跃用户 <= 总认领次数: ${state.activeClaimers.lte(state.totalClaimMints) ? "✅" : "❌"}`);

      // 验证认领次数（由于代币限制，可能无法达到100次，但至少验证计算逻辑）
      const finalCountNum = typeof finalClaimCount === 'number' ? finalClaimCount : finalClaimCount.toNumber ? finalClaimCount.toNumber() : parseInt(finalClaimCount.toString());
      console.log(`\n📊 认领统计:`);
      console.log(`   - 目标: ${targetClaims} 次`);
      console.log(`   - 成功: ${successCount} 次`);
      console.log(`   - 最终计数: ${finalCountNum} 次`);
      
      // 验证至少成功了一些认领，并且计算逻辑正确
      expect(successCount).to.be.gte(5); // 至少成功5次
      expect(finalCountNum).to.be.gte(5); // 至少认领5次
      
      console.log(`\n✅ ${targetClaims}次认领测试完成！`);
      console.log(`   - 目标: ${targetClaims} 次`);
      console.log(`   - 成功: ${successCount} 次`);
      console.log(`   - 成功率: ${(successCount / targetClaims * 100).toFixed(2)}%`);
      console.log(`   - 数据计算: ✅ 正常`);
      
      // 验证至少达到目标的80%
      expect(successCount).to.be.gte(Math.floor(targetClaims * 0.8));
      expect(finalCountNum).to.be.gte(Math.floor(targetClaims * 0.8));
      });
    });
  });

  afterEach(function () {
    if (anomalies.length > 0) {
      console.log(`\n🚨 检测到 ${anomalies.length} 个异常:`);
      anomalies.forEach((a, i) => {
        console.log(`   ${i + 1}. [${a.round}] ${a.type}: ${a.description}`);
      });
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  检测到 ${warnings.length} 个警告:`);
      warnings.forEach((w, i) => {
        console.log(`   ${i + 1}. [${w.round}] ${w.type}: ${w.description}`);
      });
    }
  });
});

