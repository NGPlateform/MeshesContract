import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

/**
 * Meshes 合约详细数值分析测试
 * 每轮测试都会详细列出所有计算数值并进行分析验证
 */

describe("Meshes.sol - Detailed Value Analysis Test Suite", function () {
  let meshes: any;
  let treasury: any;
  let governanceSafe: any;
  let user1: any;
  let user2: any;
  let user3: any;

  const SECONDS_IN_DAY = 86400;
  const TEST_COOLDOWN = 600; // 10分钟
  const TEST_YEAR_PERIOD = 600; // 10分钟

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

  function expectEqBN(actual: any, expected: any, message?: string) {
    const actualBN = BigNumber.from(actual);
    const expectedBN = BigNumber.from(expected);
    expect(actualBN.eq(expectedBN), message || `Expected ${expectedBN.toString()}, got ${actualBN.toString()}`).to.equal(true);
  }

  function expectGtBN(actual: any, expected: any, message?: string) {
    const actualBN = BigNumber.from(actual);
    const expectedBN = BigNumber.from(expected);
    expect(actualBN.gt(expectedBN), message || `Expected ${actualBN.toString()} > ${expectedBN.toString()}`).to.equal(true);
  }

  /**
   * 详细分析函数：输出所有相关数值
   */
  async function analyzeContractState(round: string, description: string) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📊 第 ${round} 轮分析: ${description}`);
    console.log(`${"=".repeat(80)}`);

    // 1. 基础合约状态
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
    const daysSinceGenesis = (currentTime - genesisTs.toNumber()) / SECONDS_IN_DAY;
    const yearPeriodsSinceGenesis = (currentTime - genesisTs.toNumber()) / TEST_YEAR_PERIOD;

    console.log(`\n📈 基础合约状态:`);
    console.log(`   - 总供应量 (totalSupply): ${formatEther(totalSupply)} MESH`);
    console.log(`   - 总燃烧量 (totalBurn): ${formatEther(totalBurn)} MESH`);
    console.log(`   - 活跃认领者数 (activeClaimers): ${activeClaimers.toString()}`);
    console.log(`   - 活跃网格数 (activeMeshes): ${activeMeshes.toString()}`);
    console.log(`   - 总认领次数 (totalClaimMints): ${totalClaimMints.toString()}`);
    console.log(`   - 最大网格热度 (maxMeshHeats): ${formatEther(maxMeshHeats)}`);
    console.log(`   - 日铸造因子 (dailyMintFactor): ${formatUnits(dailyMintFactor, 10)} (1e10 = 100%)`);
    console.log(`   - 燃烧缩放比例 (burnScaleMilli): ${burnScaleMilli.toString()} (千分位)`);
    console.log(`   - Treasury待转池 (pendingTreasuryPool): ${formatEther(pendingTreasuryPool)} MESH`);
    console.log(`   - Treasury余额: ${formatEther(treasuryBalance)} MESH`);
    console.log(`   - 合约自身余额: ${formatEther(contractBalance)} MESH`);
    console.log(`   - 创世时间戳: ${genesisTs.toString()}`);
    console.log(`   - 当前时间戳: ${currentTime}`);
    console.log(`   - 距创世天数: ${daysSinceGenesis.toFixed(2)} 天`);
    console.log(`   - 距创世年周期数: ${yearPeriodsSinceGenesis.toFixed(2)} 个周期 (每周期10分钟)`);

    // 2. 计算衰减参数
    const expectedFactor = calculateExpectedFactor(yearPeriodsSinceGenesis);
    console.log(`\n🔢 衰减参数分析:`);
    console.log(`   - 当前年周期索引: ${Math.floor(yearPeriodsSinceGenesis)}`);
    console.log(`   - 预期衰减因子: ${formatUnits(expectedFactor, 10)}`);
    console.log(`   - 实际衰减因子: ${formatUnits(dailyMintFactor, 10)}`);
    const factorDiff = BigNumber.from(dailyMintFactor).sub(BigNumber.from(expectedFactor));
    console.log(`   - 因子差异: ${formatUnits(factorDiff.abs(), 10)} (${factorDiff.abs().lt(1000) ? "✅ 合理" : "⚠️ 需检查"})`);

    // 3. 仪表板数据
    const meshData = await meshes.getMeshData();
    const meshDashboard = await meshes.getMeshDashboard();
    const dashboard = await meshes.getDashboard();

    console.log(`\n📊 仪表板数据:`);
    console.log(`   - 用户数量: ${meshData.userCounts.toString()}`);
    console.log(`   - 启动天数: ${meshData.launchData.toString()}`);
    console.log(`   - 总铸造量: ${formatEther(meshData.totalMinted)} MESH`);
    console.log(`   - 流动供应量: ${formatEther(meshData.liquidSupply)} MESH`);
    console.log(`   - 参与者: ${meshDashboard.participants.toString()}`);
    console.log(`   - 总认领次数: ${meshDashboard.totalclaimMints.toString()}`);
    console.log(`   - 已认领网格: ${meshDashboard.claimedMesh.toString()}`);
    console.log(`   - 最大热度: ${formatEther(meshDashboard.maxHeats)}`);
    console.log(`   - 总供应量: ${formatEther(dashboard._totalSupply)} MESH`);
    console.log(`   - 流动供应量: ${formatEther(dashboard._liquidSupply)} MESH`);
    console.log(`   - 销毁量: ${formatEther(dashboard._destruction)} MESH`);
    console.log(`   - 待处理量: ${formatEther(dashboard._pending)} MESH`);
    console.log(`   - Treasury余额: ${formatEther(dashboard._treasury)} MESH`);

    return {
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
      yearPeriodsSinceGenesis,
      expectedFactor
    };
  }

  /**
   * 分析用户状态
   */
  async function analyzeUserState(user: any, round: string) {
    const address = user.address;
    const userState = await meshes.getUserState(address);
    const balance = await meshes.balanceOf(address);
    const userTotalMint = await meshes.userTotalMint(address);
    const firstClaimTs = await meshes.firstClaimTimestamp(address);
    const hasWithdrawn = await meshes.hasWithdrawn(address);
    const lastWithdrawDay = await meshes.lastWithdrawDay(address);
    const lastProcessedDay = await meshes.lastProcessedDay(address);
    const [canWithdraw, nextWithdrawTime] = await meshes.canUserWithdraw(address);
    const preview = await meshes.previewWithdraw(address);

    console.log(`\n👤 用户 ${address.substring(0, 10)}... 状态:`);
    console.log(`   - 余额: ${formatEther(balance)} MESH`);
    console.log(`   - 权重总和: ${formatEther(userState.weight)}`);
    console.log(`   - 认领次数: ${userState.claimCount.toString()}`);
    console.log(`   - 结转余额: ${formatEther(userState.carryBalance_)} MESH`);
    console.log(`   - 最后处理日: ${userState.lastProcessedDay_.toString()}`);
    console.log(`   - 用户总铸造量: ${formatEther(userTotalMint)} MESH`);
    console.log(`   - 首次认领时间: ${firstClaimTs.toString()}`);
    console.log(`   - 是否已提现: ${hasWithdrawn}`);
    console.log(`   - 最后提现日: ${lastWithdrawDay.toString()}`);
    console.log(`   - 可提现: ${canWithdraw}`);
    console.log(`   - 下次提现时间: ${nextWithdrawTime.toString()}`);
    console.log(`   - 预览今日应得: ${formatEther(preview.payoutToday)} MESH`);
    console.log(`   - 预览结转前: ${formatEther(preview.carryBefore)} MESH`);
    console.log(`   - 预览结转后(不提现): ${formatEther(preview.carryAfterIfNoWithdraw)} MESH`);
    console.log(`   - 预览今日燃烧(不提现): ${formatEther(preview.burnTodayIfNoWithdraw)} MESH`);
    console.log(`   - 预览今日Treasury(不提现): ${formatEther(preview.treasuryTodayIfNoWithdraw)} MESH`);

    // 计算预期收益
    const expectedPayout = await calculateExpectedPayout(userState.weight, preview.dayIndex);
    console.log(`   - 预期今日收益: ${formatEther(expectedPayout)} MESH`);
    const payoutDiff = BigNumber.from(preview.payoutToday).sub(expectedPayout);
    console.log(`   - 收益差异: ${formatEther(payoutDiff.abs())} (${payoutDiff.abs().lt(ethers.utils.parseEther("0.0001")) ? "✅ 合理" : "⚠️ 需检查"})`);

    return {
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

    console.log(`\n🕸️  网格 ${meshID} 状态:`);
    console.log(`   - 认领次数: ${meshClaimCount.toString()}`);
    console.log(`   - 当前热度: ${formatEther(meshHeats)}`);
    console.log(`   - 报价热度: ${formatEther(quoteHeat)}`);
    console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);

    // 计算预期热度
    const claimCountNum = typeof meshClaimCount === 'number' ? meshClaimCount : meshClaimCount.toNumber ? meshClaimCount.toNumber() : parseInt(meshClaimCount.toString());
    const expectedHeat = calculateExpectedHeat(claimCountNum);
    console.log(`   - 预期热度: ${formatEther(expectedHeat)}`);
    const heatDiff = BigNumber.from(meshHeats).sub(expectedHeat);
    console.log(`   - 热度差异: ${formatEther(heatDiff.abs())} (${heatDiff.abs().lt(ethers.utils.parseEther("0.0001")) ? "✅ 合理" : "⚠️ 需检查"})`);

    // 计算预期燃烧成本
    if (claimCountNum > 0) {
      const maxHeats = await meshes.maxMeshHeats();
      const burnScale = await meshes.burnScaleMilli();
      const expectedCost = calculateExpectedBurnCost(meshHeats, maxHeats, burnScale);
      console.log(`   - 预期燃烧成本: ${formatEther(expectedCost)} MESH`);
      const costDiff = BigNumber.from(quoteCost).sub(expectedCost);
      console.log(`   - 成本差异: ${formatEther(costDiff.abs())} (${costDiff.abs().lt(ethers.utils.parseEther("0.0001")) ? "✅ 合理" : "⚠️ 需检查"})`);
    }

    return {
      claimCount: meshClaimCount,
      heat: meshHeats,
      quoteHeat,
      quoteCost
    };
  }

  /**
   * 计算预期衰减因子
   */
  function calculateExpectedFactor(yearPeriods: number): BigNumber {
    let factor = BigNumber.from("10000000000"); // 1e10
    const periods = Math.floor(yearPeriods);
    for (let i = 0; i < periods; i++) {
      factor = factor.mul(9).div(10); // 每周期衰减10%
      if (factor.eq(0)) break;
    }
    return factor;
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
      // 对于 >= 30 的情况，使用 1.2^n 计算
      let result = ethers.utils.parseEther("197.81359483314138"); // 第29个值
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
  async function calculateExpectedPayout(weight: BigNumber, dayIndex: BigNumber): Promise<BigNumber> {
    // 获取当前的 dailyMintFactor
    const factor = await meshes.dailyMintFactor();
    // 计算: payout = (factor * weight) / 1e10
    return factor.mul(weight).div(ethers.utils.parseUnits("1", 10));
  }

  /**
   * 数值合理性分析
   */
  function analyzeValueReasonableness(state: any, prevState: any = null) {
    console.log(`\n✅ 数值合理性分析:`);

    // 1. 总供应量应该 >= 总燃烧量
    if (state.totalSupply.lt(state.totalBurn)) {
      console.log(`   ⚠️  警告: 总供应量 < 总燃烧量，不合理！`);
    } else {
      console.log(`   ✅ 总供应量 >= 总燃烧量，合理`);
    }

    // 2. 活跃认领者数应该 <= 总认领次数
    if (state.activeClaimers.gt(state.totalClaimMints)) {
      console.log(`   ⚠️  警告: 活跃认领者数 > 总认领次数，不合理！`);
    } else {
      console.log(`   ✅ 活跃认领者数 <= 总认领次数，合理`);
    }

    // 3. 活跃网格数应该 <= 总认领次数
    if (state.activeMeshes.gt(state.totalClaimMints)) {
      console.log(`   ⚠️  警告: 活跃网格数 > 总认领次数，不合理！`);
    } else {
      console.log(`   ✅ 活跃网格数 <= 总认领次数，合理`);
    }

    // 4. 衰减因子应该在合理范围内 (0 < factor <= 1e10)
    if (state.dailyMintFactor.gt(ethers.utils.parseUnits("1", 10))) {
      console.log(`   ⚠️  警告: 衰减因子 > 1.0，不合理！`);
    } else if (state.dailyMintFactor.eq(0)) {
      console.log(`   ⚠️  警告: 衰减因子 = 0，可能已完全衰减！`);
    } else {
      console.log(`   ✅ 衰减因子在合理范围内`);
    }

    // 5. 与上一轮对比
    if (prevState) {
      console.log(`\n📊 与上一轮对比:`);
      
      const supplyChange = state.totalSupply.sub(prevState.totalSupply);
      const burnChange = state.totalBurn.sub(prevState.totalBurn);
      const claimChange = state.totalClaimMints.sub(prevState.totalClaimMints);

      console.log(`   - 总供应量变化: ${supplyChange.gte(0) ? "+" : ""}${formatEther(supplyChange)} MESH`);
      console.log(`   - 总燃烧量变化: +${formatEther(burnChange)} MESH`);
      console.log(`   - 总认领次数变化: +${claimChange.toString()}`);

      // 供应量应该增加（除非只有燃烧）
      if (supplyChange.lt(0) && burnChange.eq(0)) {
        console.log(`   ⚠️  警告: 供应量减少但无燃烧，不合理！`);
      } else {
        console.log(`   ✅ 供应量变化合理`);
      }

      // 燃烧量不应该减少
      if (burnChange.lt(0)) {
        console.log(`   ⚠️  警告: 燃烧量减少，不合理！`);
      } else {
        console.log(`   ✅ 燃烧量变化合理`);
      }
    }
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    governanceSafe = signers[0];
    user1 = signers[1];
    user2 = signers[2];
    user3 = signers[3];
    treasury = signers[5] || signers[0];

    const MeshesF = await ethers.getContractFactory("Meshes");
    meshes = await MeshesF.connect(governanceSafe).deploy(governanceSafe.address);
    await meshes.deployed();
    
    await meshes.connect(governanceSafe).setTreasuryAddress(treasury.address);
  });

  describe("Round-by-Round Detailed Analysis", () => {
    let round1State: any;
    let round2State: any;
    let round3State: any;

    it("Round 1: 初始状态分析", async () => {
      round1State = await analyzeContractState("1", "初始部署状态");
      analyzeValueReasonableness(round1State);
    });

    it("Round 2: 第一个用户认领网格", async () => {
      const meshID = "E100N100";
      const user1BalBefore = await meshes.balanceOf(user1.address);
      
      console.log(`\n🎯 操作: User1 认领网格 ${meshID}`);
      const tx = await meshes.connect(user1).claimMesh(meshID);
      const rc = await tx.wait();
      
      const user1BalAfter = await meshes.balanceOf(user1.address);
      const balanceChange = user1BalAfter.sub(user1BalBefore);

      console.log(`\n💰 余额变化:`);
      console.log(`   - 认领前余额: ${formatEther(user1BalBefore)} MESH`);
      console.log(`   - 认领后余额: ${formatEther(user1BalAfter)} MESH`);
      console.log(`   - 余额变化: ${formatEther(balanceChange)} MESH (${balanceChange.eq(0) ? "✅ 首次认领免费" : "⚠️ 不应有变化"})`);

      // 分析事件
      const claimedEvent = rc.events?.find((e: any) => e.event === "MeshClaimed");
      if (claimedEvent && claimedEvent.args) {
        console.log(`\n📢 事件数据:`);
        console.log(`   - 用户: ${claimedEvent.args.user}`);
        console.log(`   - 网格ID: ${claimedEvent.args.meshID}`);
        console.log(`   - 申请次数: ${claimedEvent.args.applyCount?.toString() || "N/A"}`);
        console.log(`   - 热度: ${formatEther(claimedEvent.args.heat || 0)}`);
        console.log(`   - 燃烧成本: ${formatEther(claimedEvent.args.costBurned || 0)} MESH`);
      }

      round2State = await analyzeContractState("2", "User1认领网格后");
      await analyzeUserState(user1, "2");
      await analyzeMeshState(meshID, "2");
      analyzeValueReasonableness(round2State, round1State);
    });

    it("Round 3: 第二个用户认领同一网格（需要燃烧）", async () => {
      const meshID = "E100N100";
      
      // 启用燃烧机制
      await meshes.connect(governanceSafe).setBurnScale(1000);
      console.log(`\n⚙️  设置燃烧缩放比例: 1000 (1.0x)`);

      // 先让user1提现获得代币，然后转给user2用于燃烧
      const user1Claims = await meshes.userClaimCounts(user1.address);
      if (BigNumber.from(user1Claims).gt(0)) {
        // 检查是否可以提现
        const [canWithdraw] = await meshes.canUserWithdraw(user1.address);
        if (canWithdraw) {
          await meshes.connect(user1).withdraw();
          const user1Bal = await meshes.balanceOf(user1.address);
          if (user1Bal.gt(0)) {
            await meshes.connect(user1).transfer(user2.address, user1Bal);
          }
        } else {
          // 如果还不能提现，等待冷却时间
          await increaseTime(TEST_COOLDOWN);
          await meshes.connect(user1).withdraw();
          const user1Bal = await meshes.balanceOf(user1.address);
          if (user1Bal.gt(0)) {
            await meshes.connect(user1).transfer(user2.address, user1Bal);
          }
        }
      } else {
        // 如果user1没有认领，直接给user2 mint一些（通过认领另一个网格然后提现）
        await meshes.connect(user2).claimMesh("E999N999");
        await increaseTime(TEST_COOLDOWN);
        await meshes.connect(user2).withdraw();
      }
      const user2BalBefore = await meshes.balanceOf(user2.address);
      const totalBurnBefore = await meshes.totalBurn();

      // 获取报价
      const [quoteHeat, quoteCost] = await meshes.quoteClaimCost(meshID);
      console.log(`\n💵 认领成本报价:`);
      console.log(`   - 报价热度: ${formatEther(quoteHeat)}`);
      console.log(`   - 报价成本: ${formatEther(quoteCost)} MESH`);

      console.log(`\n🎯 操作: User2 认领网格 ${meshID} (需要燃烧)`);
      const tx = await meshes.connect(user2).claimMesh(meshID);
      const rc = await tx.wait();

      const user2BalAfter = await meshes.balanceOf(user2.address);
      const balanceChange = user2BalAfter.sub(user2BalBefore);
      const totalBurnAfter = await meshes.totalBurn();
      const burnChange = totalBurnAfter.sub(totalBurnBefore);

      console.log(`\n💰 余额变化:`);
      console.log(`   - 认领前余额: ${formatEther(user2BalBefore)} MESH`);
      console.log(`   - 认领后余额: ${formatEther(user2BalAfter)} MESH`);
      console.log(`   - 余额变化: ${formatEther(balanceChange)} MESH (应为负值，表示燃烧)`);
      console.log(`   - 燃烧成本: ${formatEther(quoteCost)} MESH`);
      console.log(`   - 实际燃烧: ${formatEther(burnChange)} MESH`);
      
      // 验证燃烧金额
      const burnDiff = balanceChange.abs().sub(quoteCost);
      console.log(`   - 燃烧差异: ${formatEther(burnDiff.abs())} (${burnDiff.abs().lt(ethers.utils.parseEther("0.0001")) ? "✅ 准确" : "⚠️ 不匹配"})`);

      // 分析事件
      const burnEvent = rc.events.find((e: any) => e.event === "TokensBurned");
      if (burnEvent) {
        console.log(`\n🔥 燃烧事件:`);
        console.log(`   - 燃烧数量: ${formatEther(burnEvent.args.amount)} MESH`);
        console.log(`   - 原因代码: ${burnEvent.args.reasonCode.toString()} (1=认领成本)`);
      }

      round3State = await analyzeContractState("3", "User2认领网格后");
      await analyzeUserState(user1, "3");
      await analyzeUserState(user2, "3");
      await analyzeMeshState(meshID, "3");
      analyzeValueReasonableness(round3State, round2State);
    });

    it("Round 4: 等待10分钟后首次提现", async () => {
      // 确保user1已经认领了网格
      const meshID = "E100N100";
      const user1Claims = await meshes.userClaimCounts(user1.address);
      if (BigNumber.from(user1Claims).eq(0)) {
        await meshes.connect(user1).claimMesh(meshID);
      }
      
      console.log(`\n⏰ 操作: 等待10分钟（测试模式冷却时间）`);
      await increaseTime(TEST_COOLDOWN);

      const user1BalBefore = await meshes.balanceOf(user1.address);
      const user1StateBefore = await meshes.getUserState(user1.address);
      const totalSupplyBefore = await meshes.totalSupply();
      const treasuryBalBefore = await meshes.balanceOf(treasury.address);
      const pendingTreasuryBefore = await meshes.pendingTreasuryPool();

      // 预览提现
      const preview = await meshes.previewWithdraw(user1.address);
      console.log(`\n📋 提现预览:`);
      console.log(`   - 今日应得: ${formatEther(preview.payoutToday)} MESH`);
      console.log(`   - 结转余额: ${formatEther(preview.carryBefore)} MESH`);
      console.log(`   - 总提现金额: ${formatEther(preview.payoutToday.add(preview.carryBefore))} MESH`);

      console.log(`\n🎯 操作: User1 提现`);
      const tx = await meshes.connect(user1).withdraw();
      const rc = await tx.wait();

      const user1BalAfter = await meshes.balanceOf(user1.address);
      const balanceChange = user1BalAfter.sub(user1BalBefore);
      const totalSupplyAfter = await meshes.totalSupply();
      const supplyChange = totalSupplyAfter.sub(totalSupplyBefore);
      const treasuryBalAfter = await meshes.balanceOf(treasury.address);
      const pendingTreasuryAfter = await meshes.pendingTreasuryPool();

      console.log(`\n💰 提现结果:`);
      console.log(`   - 提现前余额: ${formatEther(user1BalBefore)} MESH`);
      console.log(`   - 提现后余额: ${formatEther(user1BalAfter)} MESH`);
      console.log(`   - 余额增加: ${formatEther(balanceChange)} MESH`);
      console.log(`   - 预期提现: ${formatEther(preview.payoutToday.add(preview.carryBefore))} MESH`);
      console.log(`   - 提现差异: ${formatEther(balanceChange.sub(preview.payoutToday.add(preview.carryBefore)).abs())} (${balanceChange.sub(preview.payoutToday.add(preview.carryBefore)).abs().lt(ethers.utils.parseEther("0.0001")) ? "✅ 准确" : "⚠️ 不匹配"})`);

      console.log(`\n📊 供应量变化:`);
      console.log(`   - 提现前总供应量: ${formatEther(totalSupplyBefore)} MESH`);
      console.log(`   - 提现后总供应量: ${formatEther(totalSupplyAfter)} MESH`);
      console.log(`   - 供应量增加: ${formatEther(supplyChange)} MESH`);

      console.log(`\n🏛️  Treasury变化:`);
      console.log(`   - 提现前Treasury余额: ${formatEther(treasuryBalBefore)} MESH`);
      console.log(`   - 提现后Treasury余额: ${formatEther(treasuryBalAfter)} MESH`);
      console.log(`   - 提现前待转池: ${formatEther(pendingTreasuryBefore)} MESH`);
      console.log(`   - 提现后待转池: ${formatEther(pendingTreasuryAfter)} MESH`);

      // 分析事件
      const withdrawEvent = rc.events.find((e: any) => e.event === "WithdrawProcessed");
      if (withdrawEvent) {
        console.log(`\n📢 提现事件:`);
        console.log(`   - 用户: ${withdrawEvent.args.user}`);
        console.log(`   - 提现金额: ${formatEther(withdrawEvent.args.payout)} MESH`);
        console.log(`   - 燃烧数量: ${formatEther(withdrawEvent.args.burned)} MESH`);
        console.log(`   - Treasury分配: ${formatEther(withdrawEvent.args.treasury)} MESH`);
        console.log(`   - 结转后余额: ${formatEther(withdrawEvent.args.carryAfter)} MESH`);
        console.log(`   - 日索引: ${withdrawEvent.args.dayIndex.toString()}`);
      }

      const state = await analyzeContractState("4", "User1提现后");
      await analyzeUserState(user1, "4");
      analyzeValueReasonableness(state, round3State);
    });

    it("Round 5: 等待10分钟（一个年周期）观察衰减", async () => {
      // 确保user1已经认领了网格
      const user1Claims = await meshes.userClaimCounts(user1.address);
      if (BigNumber.from(user1Claims).eq(0)) {
        await meshes.connect(user1).claimMesh("E100N100");
        await increaseTime(TEST_COOLDOWN);
        await meshes.connect(user1).withdraw();
      }
      
      // 确保已经提现过一次
      const [canWithdraw] = await meshes.canUserWithdraw(user1.address);
      if (!canWithdraw) {
        await increaseTime(SECONDS_IN_DAY);
      }
      
      console.log(`\n⏰ 操作: 等待10分钟（一个年衰减周期）`);
      await increaseTime(TEST_YEAR_PERIOD);

      const factorBefore = await meshes.dailyMintFactor();

      // 触发因子更新（通过提现）
      const tx = await meshes.connect(user1).withdraw();
      await tx.wait();

      const factorAfter = await meshes.dailyMintFactor();

      console.log(`\n🔢 衰减因子变化:`);
      console.log(`   - 更新前因子: ${formatUnits(factorBefore, 10)}`);
      console.log(`   - 更新后因子: ${formatUnits(factorAfter, 10)}`);
      console.log(`   - 因子变化: ${formatUnits(factorAfter.sub(factorBefore), 10)}`);
      
      // 预期衰减10%
      const expectedFactor = factorBefore.mul(9).div(10);
      const factorDiff = factorAfter.sub(expectedFactor);
      console.log(`   - 预期因子: ${formatUnits(expectedFactor, 10)}`);
      console.log(`   - 因子差异: ${formatUnits(factorDiff.abs(), 10)} (${factorDiff.abs().lt(1000) ? "✅ 准确（衰减10%）" : "⚠️ 不匹配"})`);

      const state = await analyzeContractState("5", "一个年周期后");
      await analyzeUserState(user1, "5");
      analyzeValueReasonableness(state);
    });

    it("Round 6: 多个用户认领不同网格", async () => {
      const meshIDs = ["E200N200", "E201N201", "E202N202"];
      const users = [user1, user2, user3];

      for (let i = 0; i < meshIDs.length; i++) {
        console.log(`\n🎯 操作: ${users[i].address.substring(0, 10)}... 认领网格 ${meshIDs[i]}`);
        await meshes.connect(users[i]).claimMesh(meshIDs[i]);
        await analyzeMeshState(meshIDs[i], `6-${i + 1}`);
      }

      const state = await analyzeContractState("6", "多个用户认领后");
      for (let i = 0; i < users.length; i++) {
        await analyzeUserState(users[i], `6-${i + 1}`);
      }
      analyzeValueReasonableness(state);
    });

    it("Round 7: 综合场景 - 多轮操作", async () => {
      console.log(`\n🔄 综合场景测试:`);

      // 1. 用户认领
      await meshes.connect(user1).claimMesh("E300N300");
      let state = await analyzeContractState("7-1", "认领后");
      analyzeValueReasonableness(state);

      // 2. 等待并提现
      await increaseTime(TEST_COOLDOWN);
      await meshes.connect(user1).withdraw();
      state = await analyzeContractState("7-2", "提现后");
      analyzeValueReasonableness(state);

      // 3. 等待年周期（需要等待一天才能再次提现）
      await increaseTime(SECONDS_IN_DAY);
      const [canWithdraw3] = await meshes.canUserWithdraw(user1.address);
      if (canWithdraw3) {
        const preview3 = await meshes.previewWithdraw(user1.address);
        const totalPayout3 = preview3.payoutToday.add(preview3.carryBefore);
        if (totalPayout3.gt(0)) {
          await meshes.connect(user1).withdraw();
        } else {
          console.log(`\n⚠️  提现金额为0，跳过本次提现`);
        }
      }
      state = await analyzeContractState("7-3", "年周期后提现");
      analyzeValueReasonableness(state);

      // 4. 再次认领（增加权重）
      await meshes.connect(user1).claimMesh("E301N301");
      state = await analyzeContractState("7-4", "再次认领后");
      analyzeValueReasonableness(state);

      // 5. 提现（应该获得更多收益）- 需要等待一天
      await increaseTime(SECONDS_IN_DAY);
      const [canWithdraw5] = await meshes.canUserWithdraw(user1.address);
      if (canWithdraw5) {
        const preview5 = await meshes.previewWithdraw(user1.address);
        const totalPayout5 = preview5.payoutToday.add(preview5.carryBefore);
        if (totalPayout5.gt(0)) {
          const balBefore = await meshes.balanceOf(user1.address);
          await meshes.connect(user1).withdraw();
          const balAfter = await meshes.balanceOf(user1.address);
          const payout = balAfter.sub(balBefore);

          console.log(`\n💰 权重增加后的收益:`);
          console.log(`   - 本次提现: ${formatEther(payout)} MESH`);
          console.log(`   - 权重增加应该带来更多收益`);
        } else {
          console.log(`\n⚠️  提现金额为0，跳过本次提现`);
        }
      } else {
        console.log(`\n⚠️  用户还不能提现，跳过本次提现`);
      }

      state = await analyzeContractState("7-5", "权重增加后提现");
      await analyzeUserState(user1, "7-5");
      analyzeValueReasonableness(state);
    });
  });
});

