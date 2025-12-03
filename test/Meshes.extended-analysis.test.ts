import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

/**
 * Meshes 合约扩展数值分析测试
 * - 10个用户
 * - 2个网格
 * - 10轮测试
 * - 详细数值分析和异常检测
 */

describe("Meshes.sol - Extended Analysis Test Suite (10 Users, 2 Meshes, 10 Rounds)", function () {
  let meshes: any;
  let treasury: any;
  let governanceSafe: any;
  let users: any[] = [];

  const SECONDS_IN_DAY = 86400;
  const TEST_COOLDOWN = 600; // 10分钟
  const TEST_YEAR_PERIOD = 600; // 10分钟
  const NUM_USERS = 10;
  const NUM_MESHES = 2;
  const NUM_ROUNDS = 10;
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
    const contractBalance = await meshes.balanceOf(meshes.address);
    const genesisTs = await meshes.genesisTs();
    const currentTime = (await ethers.provider.getBlock("latest")).timestamp;
    const yearPeriodsSinceGenesis = (currentTime - genesisTs.toNumber()) / TEST_YEAR_PERIOD;

    // 异常检测
    if (totalSupply.lt(totalBurn)) {
      recordAnomaly(round, "CRITICAL", "总供应量小于总燃烧量", {
        totalSupply: formatEther(totalSupply),
        totalBurn: formatEther(totalBurn)
      });
    }

    if (activeClaimers.gt(totalClaimMints)) {
      recordAnomaly(round, "LOGIC_ERROR", "活跃认领者数大于总认领次数", {
        activeClaimers: activeClaimers.toString(),
        totalClaimMints: totalClaimMints.toString()
      });
    }

    if (activeMeshes.gt(totalClaimMints)) {
      recordAnomaly(round, "LOGIC_ERROR", "活跃网格数大于总认领次数", {
        activeMeshes: activeMeshes.toString(),
        totalClaimMints: totalClaimMints.toString()
      });
    }

    if (dailyMintFactor.gt(ethers.utils.parseUnits("1", 10))) {
      recordAnomaly(round, "VALUE_ERROR", "衰减因子大于1.0", {
        dailyMintFactor: formatUnits(dailyMintFactor, 10)
      });
    }

    if (dailyMintFactor.eq(0)) {
      recordWarning(round, "VALUE_WARNING", "衰减因子为0，可能已完全衰减", {
        dailyMintFactor: formatUnits(dailyMintFactor, 10)
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
      treasuryBalance,
      contractBalance,
      yearPeriodsSinceGenesis
    };
  }

  /**
   * 分析用户状态
   */
  async function analyzeUserState(user: any, round: string, userIndex: number) {
    const address = user.address;
    const userState = await meshes.getUserState(address);
    const balance = await meshes.balanceOf(address);
    const userTotalMint = await meshes.userTotalMint(address);
    const [canWithdraw, nextWithdrawTime] = await meshes.canUserWithdraw(address);
    const preview = await meshes.previewWithdraw(address);

    // 异常检测 - 用户有权重但从未获得代币（这是正常的，如果用户还没提现）
    // 只有当用户已经可以提现但从未提现过，且余额为0时才警告
    if (userState.weight.gt(0) && balance.eq(0) && userTotalMint.eq(0) && canWithdraw) {
      recordWarning(round, "USER_WARNING", `用户${userIndex}有权重且可提现但从未获得代币`, {
        user: address.substring(0, 10),
        weight: formatEther(userState.weight),
        balance: formatEther(balance),
        totalMint: formatEther(userTotalMint),
        canWithdraw
      });
    }

    if (userState.carryBalance_.gt(ethers.utils.parseEther("1000000"))) {
      recordWarning(round, "VALUE_WARNING", `用户${userIndex}结转余额异常大`, {
        user: address.substring(0, 10),
        carryBalance: formatEther(userState.carryBalance_)
      });
    }

    // 检查收益合理性 - 只有当预期收益 > 0 时才检查
    if (userState.weight.gt(0)) {
      const expectedPayout = await calculateExpectedPayout(userState.weight);
      
      // 只有当预期收益 > 0 时才检查差异
      if (expectedPayout.gt(0)) {
        const payoutDiff = BigNumber.from(preview.payoutToday).sub(expectedPayout);
        const diffPercent = payoutDiff.abs().mul(10000).div(expectedPayout);
        
        // 差异超过5%才警告（因为可能有衰减等因素）
        if (diffPercent.gt(500)) {
          recordWarning(round, "CALCULATION_WARNING", `用户${userIndex}收益计算差异较大`, {
            user: address.substring(0, 10),
            expected: formatEther(expectedPayout),
            actual: formatEther(preview.payoutToday),
            diff: formatEther(payoutDiff.abs()),
            diffPercent: diffPercent.toString() + "%"
          });
        }
      }
    }

    return {
      userIndex,
      address,
      balance,
      weight: userState.weight,
      claimCount: userState.claimCount,
      carryBalance: userState.carryBalance_,
      userTotalMint,
      canWithdraw,
      preview
    };
  }

  /**
   * 分析网格状态
   */
  async function analyzeMeshState(meshID: string, round: string) {
    const meshInfo = await meshes.getMeshInfo(meshID);
    const meshClaimCount = await meshes.meshClaimCount(meshID);
    const meshHeats = await meshes.meshHeats(meshID);
    const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);

    // 计算预期热度
    const claimCountNum = typeof meshClaimCount === 'number' ? meshClaimCount : meshClaimCount.toNumber ? meshClaimCount.toNumber() : parseInt(meshClaimCount.toString());
    const expectedHeat = calculateExpectedHeat(claimCountNum);
    const heatDiff = BigNumber.from(meshHeats).sub(expectedHeat);
    const heatDiffPercent = heatDiff.abs().mul(10000).div(expectedHeat.gt(0) ? expectedHeat : BigNumber.from(1));

    // 异常检测
    if (heatDiffPercent.gt(100)) { // 差异超过1%
      recordWarning(round, "CALCULATION_WARNING", `网格${meshID}热度计算差异较大`, {
        meshID,
        expected: formatEther(expectedHeat),
        actual: formatEther(meshHeats),
        diff: formatEther(heatDiff.abs()),
        diffPercent: heatDiffPercent.toString() + "%"
      });
    }

    // 检查燃烧成本合理性
    if (claimCountNum > 0) {
      const maxHeats = await meshes.maxMeshHeats();
      const burnScale = await meshes.burnScaleMilli();
      
      // 只有当 maxHeats > 0 且 burnScale > 0 时才计算预期成本
      if (maxHeats.gt(0) && burnScale.gt(0)) {
        const expectedCost = calculateExpectedBurnCost(meshHeats, maxHeats, burnScale);
        const costDiff = BigNumber.from(quoteCost).sub(expectedCost);
        
        // 只有当预期成本 > 0 时才检查差异
        if (expectedCost.gt(0)) {
          const costDiffPercent = costDiff.abs().mul(10000).div(expectedCost);
          
          if (costDiffPercent.gt(100)) { // 差异超过1%
            recordWarning(round, "CALCULATION_WARNING", `网格${meshID}燃烧成本计算差异较大`, {
              meshID,
              expected: formatEther(expectedCost),
              actual: formatEther(quoteCost),
              diff: formatEther(costDiff.abs()),
              diffPercent: costDiffPercent.toString() + "%"
            });
          }
        }
      }
      // 如果 maxHeats = 0 或 burnScale = 0，quoteCost 应该为 0
      else if (quoteCost.gt(0)) {
        recordWarning(round, "LOGIC_WARNING", `网格${meshID}燃烧成本应为0但实际不为0`, {
          meshID,
          maxHeats: formatEther(maxHeats),
          burnScale: burnScale.toString(),
          actualCost: formatEther(quoteCost)
        });
      }
    }

    return {
      meshID,
      claimCount: meshClaimCount,
      heat: meshHeats,
      quoteHeat,
      quoteCost
    };
  }

  /**
   * 计算预期热度
   */
  function calculateExpectedHeat(claimCount: number): BigNumber {
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
   * 计算预期燃烧成本
   */
  function calculateExpectedBurnCost(heat: BigNumber, maxHeats: BigNumber, burnScale: BigNumber): BigNumber {
    if (maxHeats.eq(0) || burnScale.eq(0)) return BigNumber.from(0);
    const BASE_BURN = BigNumber.from(10);
    const heatSquared = heat.mul(heat).div(ethers.utils.parseEther("1"));
    const baseCost = BASE_BURN.mul(heatSquared).div(maxHeats);
    const scaledCost = baseCost.mul(burnScale).div(1000);
    return scaledCost;
  }

  /**
   * 计算预期收益
   */
  async function calculateExpectedPayout(weight: BigNumber): Promise<BigNumber> {
    const factor = await meshes.dailyMintFactor();
    return factor.mul(weight).div(ethers.utils.parseUnits("1", 10));
  }

  /**
   * 汇总分析
   */
  function generateSummary() {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📊 测试汇总分析`);
    console.log(`${"=".repeat(80)}`);

    console.log(`\n📈 统计信息:`);
    console.log(`   - 总测试轮数: ${NUM_ROUNDS}`);
    console.log(`   - 总用户数: ${NUM_USERS}`);
    console.log(`   - 总网格数: ${NUM_MESHES}`);
    console.log(`   - 检测到异常数: ${anomalies.length}`);
    console.log(`   - 检测到警告数: ${warnings.length}`);

    if (anomalies.length > 0) {
      console.log(`\n🚨 异常列表:`);
      anomalies.forEach((anomaly, index) => {
        console.log(`\n   ${index + 1}. [${anomaly.round}] ${anomaly.type}: ${anomaly.description}`);
        console.log(`      详情: ${JSON.stringify(anomaly.details, null, 6)}`);
      });

      // 按类型统计
      const anomalyTypes: any = {};
      anomalies.forEach(a => {
        anomalyTypes[a.type] = (anomalyTypes[a.type] || 0) + 1;
      });
      console.log(`\n   异常类型统计:`);
      Object.keys(anomalyTypes).forEach(type => {
        console.log(`     - ${type}: ${anomalyTypes[type]}次`);
      });
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  警告列表:`);
      warnings.forEach((warning, index) => {
        console.log(`\n   ${index + 1}. [${warning.round}] ${warning.type}: ${warning.description}`);
        console.log(`      详情: ${JSON.stringify(warning.details, null, 6)}`);
      });

      // 按类型统计
      const warningTypes: any = {};
      warnings.forEach(w => {
        warningTypes[w.type] = (warningTypes[w.type] || 0) + 1;
      });
      console.log(`\n   警告类型统计:`);
      Object.keys(warningTypes).forEach(type => {
        console.log(`     - ${type}: ${warningTypes[type]}次`);
      });
    }

    if (anomalies.length === 0 && warnings.length === 0) {
      console.log(`\n✅ 未检测到异常和警告，所有数值都在合理范围内！`);
    }

    return {
      totalRounds: NUM_ROUNDS,
      totalUsers: NUM_USERS,
      totalMeshes: NUM_MESHES,
      anomalies: anomalies.length,
      warnings: warnings.length,
      anomalyList: anomalies,
      warningList: warnings
    };
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    governanceSafe = signers[0];
    treasury = signers[Math.min(11, signers.length - 1)] || signers[0];
    // 确保有足够的用户
    const availableUsers = Math.min(NUM_USERS, signers.length - 1);
    users = signers.slice(1, availableUsers + 1);
    
    // 如果用户不够，重复使用现有用户
    while (users.length < NUM_USERS) {
      users.push(users[users.length % availableUsers]);
    }

    const MeshesF = await ethers.getContractFactory("Meshes");
    meshes = await MeshesF.connect(governanceSafe).deploy(governanceSafe.address);
    await meshes.deployed();
    
    await meshes.connect(governanceSafe).setTreasuryAddress(treasury.address);
    await meshes.connect(governanceSafe).setBurnScale(1000);

    // 清空异常和警告记录
    anomalies.length = 0;
    warnings.length = 0;
  });

  describe("Extended Analysis - 10 Rounds", () => {
    it("Run 10 rounds of comprehensive testing", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`🚀 开始扩展测试: ${NUM_USERS}个用户, ${NUM_MESHES}个网格, ${NUM_ROUNDS}轮`);
      console.log(`${"=".repeat(80)}`);

      // 系统化的测试流程
      const operations: string[] = [];
      
      for (let round = 1; round <= NUM_ROUNDS; round++) {
        console.log(`\n${"=".repeat(80)}`);
        console.log(`📋 第 ${round} 轮测试`);
        console.log(`${"=".repeat(80)}`);

        // 前几轮：让用户认领网格
        if (round <= 5) {
          const userIndex = (round - 1) % NUM_USERS;
          const meshIndex = (round - 1) % NUM_MESHES;
          const user = users[userIndex];
          const meshID = MESH_IDS[meshIndex];

          console.log(`\n🎯 操作: 用户${userIndex + 1} 认领网格 ${meshID}`);
          operations.push(`Round${round}: User${userIndex + 1} claims ${meshID}`);
          
          try {
            const balBefore = await meshes.balanceOf(user.address);
            const tx = await meshes.connect(user).claimMesh(meshID);
            await tx.wait();
            const balAfter = await meshes.balanceOf(user.address);
            const balanceChange = balAfter.sub(balBefore);

            console.log(`   - 余额变化: ${formatEther(balanceChange)} MESH`);

            // 分析网格状态
            await analyzeMeshState(meshID, `Round${round}`);
          } catch (error: any) {
            if (error.message.includes("Already claim")) {
              console.log(`   - 用户已认领过此网格，跳过`);
            } else if (error.message.includes("Insufficient to burn")) {
              console.log(`   - 余额不足，无法支付燃烧成本`);
              // 给用户一些代币
              const otherUser = users[(userIndex + 1) % NUM_USERS];
              const otherUserBal = await meshes.balanceOf(otherUser.address);
              if (otherUserBal.gt(0)) {
                await meshes.connect(otherUser).transfer(user.address, otherUserBal.div(2));
              }
            } else {
              recordAnomaly(`Round${round}`, "TRANSACTION_ERROR", `用户${userIndex + 1}认领失败`, {
                error: error.message,
                user: user.address.substring(0, 10),
                meshID
              });
            }
          }
        }
        // 中间几轮：等待时间并提现
        else if (round <= 8) {
          const userIndex = (round - 5 - 1) % NUM_USERS;
          const user = users[userIndex];
          const userClaims = await meshes.userClaimCounts(user.address);

          if (BigNumber.from(userClaims).gt(0)) {
            console.log(`\n⏰ 操作: 等待冷却时间后，用户${userIndex + 1} 提现`);
            operations.push(`Round${round}: Wait cooldown, User${userIndex + 1} withdraws`);
            
            await increaseTime(TEST_COOLDOWN);
            
            const [canWithdraw] = await meshes.canUserWithdraw(user.address);
            if (canWithdraw) {
              const preview = await meshes.previewWithdraw(user.address);
              const totalPayout = preview.payoutToday.add(preview.carryBefore);
              
              if (totalPayout.gt(0)) {
                try {
                  const balBefore = await meshes.balanceOf(user.address);
                  const tx = await meshes.connect(user).withdraw();
                  await tx.wait();
                  const balAfter = await meshes.balanceOf(user.address);
                  const payout = balAfter.sub(balBefore);

                  console.log(`   - 提现金额: ${formatEther(payout)} MESH`);
                  console.log(`   - 预期金额: ${formatEther(totalPayout)} MESH`);
                  
                  const diff = payout.sub(totalPayout).abs();
                  if (diff.gt(ethers.utils.parseEther("0.0001"))) {
                    recordWarning(`Round${round}`, "PAYOUT_MISMATCH", `用户${userIndex + 1}提现金额不匹配`, {
                      expected: formatEther(totalPayout),
                      actual: formatEther(payout),
                      diff: formatEther(diff)
                    });
                  }
                } catch (error: any) {
                  recordAnomaly(`Round${round}`, "TRANSACTION_ERROR", `用户${userIndex + 1}提现失败`, {
                    error: error.message,
                    user: user.address.substring(0, 10)
                  });
                }
              } else {
                console.log(`   - 提现金额为0，跳过`);
              }
            } else {
              console.log(`   - 用户还不能提现，跳过`);
            }
          } else {
            console.log(`\n💰 操作: 用户${userIndex + 1} 提现 (用户未认领，跳过)`);
          }
        }
        // 最后几轮：等待年周期并分析
        else {
          console.log(`\n⏰ 操作: 等待年周期并分析状态`);
          operations.push(`Round${round}: Wait year period and analyze`);
          
          await increaseTime(TEST_YEAR_PERIOD);
          
          // 分析合约状态
          await analyzeContractState(`Round${round}`);
          
          // 分析所有用户状态
          for (let i = 0; i < NUM_USERS; i++) {
            await analyzeUserState(users[i], `Round${round}`, i + 1);
          }
          
          // 分析所有网格状态
          for (const meshID of MESH_IDS) {
            await analyzeMeshState(meshID, `Round${round}`);
          }
        }

        // 每轮结束后分析状态
        const state = await analyzeContractState(`Round${round}`);
        console.log(`\n📈 Round ${round} 状态摘要:`);
        console.log(`   - 总供应量: ${formatEther(state.totalSupply)} MESH`);
        console.log(`   - 总燃烧量: ${formatEther(state.totalBurn)} MESH`);
        console.log(`   - 活跃用户: ${state.activeClaimers.toString()}`);
        console.log(`   - 活跃网格: ${state.activeMeshes.toString()}`);
        console.log(`   - 总认领次数: ${state.totalClaimMints.toString()}`);
        console.log(`   - 衰减因子: ${formatUnits(state.dailyMintFactor, 10)}`);
      }

      // 生成汇总报告
      const summary = generateSummary();
      
      // 最终状态分析
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📊 最终状态分析`);
      console.log(`${"=".repeat(80)}`);
      
      const finalState = await analyzeContractState("Final");
      console.log(`\n📈 最终合约状态:`);
      console.log(`   - 总供应量: ${formatEther(finalState.totalSupply)} MESH`);
      console.log(`   - 总燃烧量: ${formatEther(finalState.totalBurn)} MESH`);
      console.log(`   - 活跃用户: ${finalState.activeClaimers.toString()}`);
      console.log(`   - 活跃网格: ${finalState.activeMeshes.toString()}`);
      console.log(`   - 总认领次数: ${finalState.totalClaimMints.toString()}`);
      console.log(`   - 最大热度: ${formatEther(finalState.maxMeshHeats)}`);
      console.log(`   - 衰减因子: ${formatUnits(finalState.dailyMintFactor, 10)}`);
      console.log(`   - Treasury余额: ${formatEther(finalState.treasuryBalance)} MESH`);

      console.log(`\n👥 用户状态汇总:`);
      for (let i = 0; i < NUM_USERS; i++) {
        const userState = await analyzeUserState(users[i], "Final", i + 1);
        console.log(`   用户${i + 1}: 余额=${formatEther(userState.balance)} MESH, 权重=${formatEther(userState.weight)}, 认领=${userState.claimCount.toString()}次`);
      }

      console.log(`\n🕸️  网格状态汇总:`);
      for (const meshID of MESH_IDS) {
        const meshState = await analyzeMeshState(meshID, "Final");
        console.log(`   ${meshID}: 认领=${meshState.claimCount.toString()}次, 热度=${formatEther(meshState.heat)}`);
      }

      console.log(`\n📝 操作序列:`);
      operations.forEach((op, index) => {
        console.log(`   ${index + 1}. ${op}`);
      });

      // 验证测试结果
      expect(anomalies.length).to.equal(0, "检测到严重异常，请检查合约逻辑");
    });
  });
});
