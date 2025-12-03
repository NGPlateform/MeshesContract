// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { BigNumber } from "ethers";

/**
 * @title Treasury 和 Reward 合约集成测试
 * @dev 验证资金划转及支付管理机制
 * 
 * 测试覆盖：
 * 1. Meshes → MeshesTreasury 资金流转
 * 2. MeshesTreasury → FoundationManage 资金流转
 * 3. FoundationManage → Reward 资金流转
 * 4. Reward 用户提取机制
 * 5. 权限控制和安全性
 * 6. 余额平衡机制
 * 7. 潜在问题分析
 */
describe("Treasury and Reward Integration Tests", () => {
  let meshes: Contract;
  let treasury: Contract;
  let foundationManage: Contract;
  let reward: Contract;
  let mockERC20: Contract;
  
  let owner: SignerWithAddress;
  let safe: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let recipient1: SignerWithAddress;
  let recipient2: SignerWithAddress;
  
  const INITIAL_SUPPLY = ethers.utils.parseEther("1000000");
  const TEST_AMOUNT = ethers.utils.parseEther("1000");
  const REWARD_AMOUNT = ethers.utils.parseEther("100");
  
  // 记录测试中发现的问题
  const issues: Array<{
    severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
    category: string;
    description: string;
    details?: any;
  }> = [];
  
  function recordIssue(severity: "HIGH" | "MEDIUM" | "LOW" | "INFO", category: string, description: string, details?: any) {
    issues.push({ severity, category, description, details });
    console.log(`\n⚠️  [${severity}] ${category}: ${description}`);
    if (details) {
      console.log(`   详情:`, details);
    }
  }
  
  beforeEach(async () => {
    [owner, safe, user1, user2, recipient1, recipient2] = await ethers.getSigners();
    issues.length = 0;
    
    // 部署 Mock ERC20 代币
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockERC20 = await MockERC20.deploy("Test Token", "TEST");
    await mockERC20.deployed();
    
    // 给 owner 铸造代币
    await mockERC20.mint(owner.address, INITIAL_SUPPLY);
    
    // 部署 Meshes 合约
    const Meshes = await ethers.getContractFactory("Meshes");
    meshes = await Meshes.connect(owner).deploy(owner.address);
    await meshes.deployed();
    
    // 部署 MeshesTreasury
    const MeshesTreasury = await ethers.getContractFactory("MeshesTreasury");
    treasury = await MeshesTreasury.connect(owner).deploy(safe.address);
    await treasury.deployed();
    
    // 部署 FoundationManage（需要 treasury 地址作为构造函数参数）
    const FoundationManage = await ethers.getContractFactory("FoundationManage");
    foundationManage = await FoundationManage.connect(owner).deploy(treasury.address);
    await foundationManage.deployed();
    
    // 部署 Reward
    const Reward = await ethers.getContractFactory("Reward");
    reward = await Reward.connect(owner).deploy(
      mockERC20.address,
      foundationManage.address,
      safe.address
    );
    await reward.deployed();
    
    // 配置 Treasury
    await treasury.connect(owner).setMeshToken(mockERC20.address);
    await treasury.connect(safe).setFoundationManage(foundationManage.address);
    await treasury.connect(safe).setRecipient(foundationManage.address, true);
    
    // 配置 FoundationManage
    await foundationManage.connect(owner).setMeshToken(mockERC20.address);
    await foundationManage.connect(owner).setAutoRecipient(reward.address, true);
    await foundationManage.connect(owner).setInitiator(safe.address, true);
    
    // 配置 Meshes
    await meshes.connect(owner).setTreasuryAddress(treasury.address);
    
    // 给 Meshes 合约一些代币用于测试
    await mockERC20.transfer(meshes.address, TEST_AMOUNT);
  });
  
  describe("资金流转测试", () => {
    it("测试完整资金流转路径: Meshes → Treasury → Foundation → Reward", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 测试完整资金流转路径`);
      console.log(`${"=".repeat(80)}`);
      
      // 步骤1: Meshes → Treasury
      console.log(`\n1️⃣  Meshes → Treasury`);
      const treasuryBalanceBefore = await mockERC20.balanceOf(treasury.address);
      console.log(`   - Treasury 初始余额: ${ethers.utils.formatEther(treasuryBalanceBefore)} MESH`);
      
      // 模拟 Meshes 合约向 Treasury 转账（实际应该通过 _maybePayoutTreasury）
      // 注意：这里直接转账模拟，实际应该通过 Meshes 合约的 _maybePayoutTreasury 函数
      // 由于 Meshes 合约需要特殊权限，这里直接转账到 Treasury
      await mockERC20.transfer(treasury.address, ethers.utils.parseEther("500"));
      
      const treasuryBalanceAfter = await mockERC20.balanceOf(treasury.address);
      console.log(`   - Treasury 转账后余额: ${ethers.utils.formatEther(treasuryBalanceAfter)} MESH`);
      expect(treasuryBalanceAfter.gt(treasuryBalanceBefore)).to.be.true;
      
      // 步骤2: Treasury → FoundationManage
      console.log(`\n2️⃣  Treasury → FoundationManage`);
      const foundationBalanceBefore = await mockERC20.balanceOf(foundationManage.address);
      console.log(`   - Foundation 初始余额: ${ethers.utils.formatEther(foundationBalanceBefore)} MESH`);
      
      // 通过 Safe 从 Treasury 转账到 FoundationManage
      await treasury.connect(safe).transferTo(
        foundationManage.address,
        ethers.utils.parseEther("300")
      );
      
      const foundationBalanceAfter = await mockERC20.balanceOf(foundationManage.address);
      console.log(`   - Foundation 转账后余额: ${ethers.utils.formatEther(foundationBalanceAfter)} MESH`);
      expect(foundationBalanceAfter.gt(foundationBalanceBefore)).to.be.true;
      
      // 步骤3: FoundationManage → Reward
      console.log(`\n3️⃣  FoundationManage → Reward`);
      const rewardBalanceBefore = await mockERC20.balanceOf(reward.address);
      console.log(`   - Reward 初始余额: ${ethers.utils.formatEther(rewardBalanceBefore)} MESH`);
      
      // 配置 FoundationManage 的自动转账限额
      await foundationManage.connect(owner).setAutoLimit(
        safe.address,
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("5000"),
        true
      );
      await foundationManage.connect(owner).setAutoRecipientLimit(
        reward.address,
        ethers.utils.parseEther("1000"),
        ethers.utils.parseEther("5000"),
        true
      );
      await foundationManage.connect(owner).setGlobalAutoDailyMax(ethers.utils.parseEther("10000"));
      await foundationManage.connect(owner).setGlobalAutoEnabled(true);
      
      // 通过自动转账从 FoundationManage 转账到 Reward
      await foundationManage.connect(safe).autoTransferTo(
        reward.address,
        REWARD_AMOUNT
      );
      
      const rewardBalanceAfter = await mockERC20.balanceOf(reward.address);
      console.log(`   - Reward 转账后余额: ${ethers.utils.formatEther(rewardBalanceAfter)} MESH`);
      expect(rewardBalanceAfter.gt(rewardBalanceBefore)).to.be.true;
      
      // 步骤4: 设置用户奖励并提取
      console.log(`\n4️⃣  设置用户奖励并提取`);
      await reward.connect(safe).setUserReward(
        [user1.address],
        [REWARD_AMOUNT],
        REWARD_AMOUNT
      );
      
      const userRewardBefore = await mockERC20.balanceOf(user1.address);
      console.log(`   - 用户1 初始余额: ${ethers.utils.formatEther(userRewardBefore)} MESH`);
      
      await reward.connect(user1).withdraw(REWARD_AMOUNT);
      
      const userRewardAfter = await mockERC20.balanceOf(user1.address);
      console.log(`   - 用户1 提取后余额: ${ethers.utils.formatEther(userRewardAfter)} MESH`);
      expect(userRewardAfter.sub(userRewardBefore).eq(REWARD_AMOUNT)).to.be.true;
      
      console.log(`\n✅ 完整资金流转路径测试通过`);
    });
    
    it("测试余额平衡机制", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 测试余额平衡机制`);
      console.log(`${"=".repeat(80)}`);
      
      // 给 Treasury 和 FoundationManage 一些初始余额
      await mockERC20.transfer(treasury.address, ethers.utils.parseEther("1000"));
      await mockERC20.transfer(foundationManage.address, ethers.utils.parseEther("200"));
      
      const [treasuryBalBefore, foundationBalBefore] = await treasury.getBalanceInfo();
      console.log(`\n📊 平衡前:`);
      console.log(`   - Treasury 余额: ${ethers.utils.formatEther(treasuryBalBefore)} MESH`);
      console.log(`   - Foundation 余额: ${ethers.utils.formatEther(foundationBalBefore)} MESH`);
      console.log(`   - 总余额: ${ethers.utils.formatEther(treasuryBalBefore.add(foundationBalBefore))} MESH`);
      
      // balanceRatio 默认是 50，如果需要修改可以通过添加 setBalanceRatio 函数
      // 这里使用默认的 50:50 比例
      
      // 执行余额平衡
      await treasury.connect(safe).balanceFoundationManage();
      
      const [treasuryBalAfter, foundationBalAfter] = await treasury.getBalanceInfo();
      console.log(`\n📊 平衡后:`);
      console.log(`   - Treasury 余额: ${ethers.utils.formatEther(treasuryBalAfter)} MESH`);
      console.log(`   - Foundation 余额: ${ethers.utils.formatEther(foundationBalAfter)} MESH`);
      console.log(`   - 总余额: ${ethers.utils.formatEther(treasuryBalAfter.add(foundationBalAfter))} MESH`);
      
      // 验证平衡结果（允许小误差）
      const totalBalance = treasuryBalAfter.add(foundationBalAfter);
      const expectedTreasury = totalBalance.mul(50).div(100);
      const treasuryDiff = treasuryBalAfter.sub(expectedTreasury).abs();
      const tolerance = ethers.utils.parseEther("0.01");
      
      console.log(`\n✅ 验证:`);
      console.log(`   - 预期 Treasury 余额: ${ethers.utils.formatEther(expectedTreasury)} MESH`);
      console.log(`   - 实际 Treasury 余额: ${ethers.utils.formatEther(treasuryBalAfter)} MESH`);
      console.log(`   - 差异: ${ethers.utils.formatEther(treasuryDiff)} MESH`);
      
      expect(treasuryDiff.lt(tolerance)).to.be.true;
    });
  });
  
  describe("权限控制测试", () => {
    it("测试 Treasury 权限控制", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 测试 Treasury 权限控制`);
      console.log(`${"=".repeat(80)}`);
      
      await mockERC20.transfer(treasury.address, TEST_AMOUNT);
      
      // 测试：非 Safe 地址不能转账
      await expect(
        treasury.connect(user1).transferTo(recipient1.address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("MeshesTreasury: only Safe");
      
      // 测试：未在白名单的地址不能接收转账
      await expect(
        treasury.connect(safe).transferTo(recipient1.address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("MeshesTreasury: recipient not approved");
      
      // 测试：添加白名单后可以转账
      await treasury.connect(safe).setRecipient(recipient1.address, true);
      await treasury.connect(safe).transferTo(recipient1.address, ethers.utils.parseEther("100"));
      
      const recipientBalance = await mockERC20.balanceOf(recipient1.address);
      expect(recipientBalance.eq(ethers.utils.parseEther("100"))).to.be.true;
      
      console.log(`\n✅ Treasury 权限控制测试通过`);
    });
    
    it("测试 Reward 权限控制", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 测试 Reward 权限控制`);
      console.log(`${"=".repeat(80)}`);
      
      await mockERC20.transfer(reward.address, TEST_AMOUNT);
      
      // 测试：非 Safe 地址不能设置奖励
      await expect(
        reward.connect(user1).setUserReward(
          [user1.address],
          [REWARD_AMOUNT],
          REWARD_AMOUNT
        )
      ).to.be.revertedWith("Only Safe");
      
      // 测试：Safe 可以设置奖励
      await reward.connect(safe).setUserReward(
        [user1.address],
        [REWARD_AMOUNT],
        REWARD_AMOUNT
      );
      
      const rewardInfo = await reward.getRewardAmount(user1.address);
      expect(rewardInfo.totalAmount.eq(REWARD_AMOUNT)).to.be.true;
      
      console.log(`\n✅ Reward 权限控制测试通过`);
    });
  });
  
  describe("潜在问题分析", () => {
    it("分析资金流转中的潜在问题", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 分析资金流转中的潜在问题`);
      console.log(`${"=".repeat(80)}`);
      
      // 问题1: Treasury 余额不足时的处理
      console.log(`\n🔍 问题1: Treasury 余额不足时的处理`);
      await expect(
        treasury.connect(safe).transferTo(foundationManage.address, ethers.utils.parseEther("1000000"))
      ).to.be.revertedWith("MeshesTreasury: insufficient");
      recordIssue("MEDIUM", "余额检查", "Treasury 余额不足时会正确回滚，但缺少余额预警机制");
      
      // 问题2: Reward 余额不足时的处理
      console.log(`\n🔍 问题2: Reward 余额不足时的处理`);
      await reward.connect(safe).setUserReward(
        [user1.address],
        [REWARD_AMOUNT],
        REWARD_AMOUNT
      );
      
      await expect(
        reward.connect(user1).withdraw(REWARD_AMOUNT)
      ).to.be.revertedWith("Insufficient buffer");
      recordIssue("HIGH", "余额管理", "Reward 合约余额不足时用户无法提取，需要自动补充机制");
      
      // 问题3: 余额平衡机制的边界情况
      console.log(`\n🔍 问题3: 余额平衡机制的边界情况`);
      await mockERC20.transfer(treasury.address, ethers.utils.parseEther("100"));
      await mockERC20.transfer(foundationManage.address, ethers.utils.parseEther("1000"));
      
      // Foundation 余额大于 Treasury，平衡机制不会执行转账
      const [treasuryBal, foundationBal] = await treasury.getBalanceInfo();
      console.log(`   - Treasury 余额: ${ethers.utils.formatEther(treasuryBal)} MESH`);
      console.log(`   - Foundation 余额: ${ethers.utils.formatEther(foundationBal)} MESH`);
      
      await treasury.connect(safe).balanceFoundationManage();
      
      const [treasuryBalAfter, foundationBalAfter] = await treasury.getBalanceInfo();
      console.log(`   - 平衡后 Treasury 余额: ${ethers.utils.formatEther(treasuryBalAfter)} MESH`);
      console.log(`   - 平衡后 Foundation 余额: ${ethers.utils.formatEther(foundationBalAfter)} MESH`);
      
      // 验证：只允许从 Treasury 向 Foundation 转账，不允许反向
      expect(treasuryBalAfter.eq(treasuryBal)).to.be.true;
      expect(foundationBalAfter.eq(foundationBal)).to.be.true;
      recordIssue("INFO", "余额平衡", "余额平衡机制只支持单向转账（Treasury → Foundation），这是设计选择");
      
      // 问题4: 提取限额检查
      console.log(`\n🔍 问题4: 提取限额检查`);
      await mockERC20.transfer(reward.address, TEST_AMOUNT);
      await reward.connect(safe).setWithdrawLimits(
        ethers.utils.parseEther("10"),
        ethers.utils.parseEther("50")
      );
      
      await reward.connect(safe).setUserReward(
        [user1.address],
        [REWARD_AMOUNT],
        REWARD_AMOUNT
      );
      
      // 测试最小限额
      await expect(
        reward.connect(user1).withdraw(ethers.utils.parseEther("5"))
      ).to.be.revertedWith("Below minimum withdraw amount");
      
      // 测试最大限额
      await expect(
        reward.connect(user1).withdraw(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Exceeds maximum withdraw amount");
      
      console.log(`   ✅ 提取限额检查正常工作`);
      
      // 问题5: 治理模式切换
      console.log(`\n🔍 问题5: 治理模式切换`);
      const isSafeGovernanceBefore = await treasury.isSafeGovernance();
      console.log(`   - 当前治理模式: ${isSafeGovernanceBefore ? "Safe" : "Owner"}`);
      
      // Owner 可以切换到 Safe 模式
      await treasury.connect(owner).switchToSafeGovernance();
      
      const isSafeGovernanceAfter = await treasury.isSafeGovernance();
      console.log(`   - 切换后治理模式: ${isSafeGovernanceAfter ? "Safe" : "Owner"}`);
      expect(isSafeGovernanceAfter).to.be.true;
      
      // 切换到 Safe 模式后，Owner 不能再执行治理操作
      await expect(
        treasury.connect(owner).setMeshToken(mockERC20.address)
      ).to.be.revertedWith("MeshesTreasury: only Safe governance");
      
      recordIssue("INFO", "治理模式", "治理模式切换后无法回退，这是安全设计");
    });
    
    it("分析资金流转效率问题", async () => {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📋 分析资金流转效率问题`);
      console.log(`${"=".repeat(80)}`);
      
      // 问题1: 多次小额转账 vs 单次大额转账
      console.log(`\n🔍 问题1: 多次小额转账 vs 单次大额转账`);
      await mockERC20.transfer(treasury.address, ethers.utils.parseEther("1000"));
      
      const gasUsed1: number[] = [];
      for (let i = 0; i < 5; i++) {
        const tx = await treasury.connect(safe).transferTo(
          foundationManage.address,
          ethers.utils.parseEther("100")
        );
        const receipt = await tx.wait();
        gasUsed1.push(receipt.gasUsed.toNumber());
      }
      const totalGas1 = gasUsed1.reduce((a, b) => a + b, 0);
      console.log(`   - 5次小额转账总 Gas: ${totalGas1}`);
      
      await mockERC20.transfer(treasury.address, ethers.utils.parseEther("500"));
      const tx2 = await treasury.connect(safe).transferTo(
        foundationManage.address,
        ethers.utils.parseEther("500")
      );
      const receipt2 = await tx2.wait();
      const gasUsed2 = receipt2.gasUsed.toNumber();
      console.log(`   - 1次大额转账 Gas: ${gasUsed2}`);
      console.log(`   - Gas 节省: ${totalGas1 - gasUsed2} (${((totalGas1 - gasUsed2) / totalGas1 * 100).toFixed(2)}%)`);
      
      recordIssue("LOW", "Gas 优化", "建议使用批量转账功能以减少 Gas 消耗");
    });
  });
  
  afterEach(function () {
    if (issues.length > 0) {
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📊 问题汇总 (共 ${issues.length} 个)`);
      console.log(`${"=".repeat(80)}`);
      
      const highIssues = issues.filter(i => i.severity === "HIGH");
      const mediumIssues = issues.filter(i => i.severity === "MEDIUM");
      const lowIssues = issues.filter(i => i.severity === "LOW");
      const infoIssues = issues.filter(i => i.severity === "INFO");
      
      if (highIssues.length > 0) {
        console.log(`\n🔴 高危问题 (${highIssues.length}):`);
        highIssues.forEach((issue, i) => {
          console.log(`   ${i + 1}. [${issue.category}] ${issue.description}`);
        });
      }
      
      if (mediumIssues.length > 0) {
        console.log(`\n🟡 中危问题 (${mediumIssues.length}):`);
        mediumIssues.forEach((issue, i) => {
          console.log(`   ${i + 1}. [${issue.category}] ${issue.description}`);
        });
      }
      
      if (lowIssues.length > 0) {
        console.log(`\n🟢 低危问题 (${lowIssues.length}):`);
        lowIssues.forEach((issue, i) => {
          console.log(`   ${i + 1}. [${issue.category}] ${issue.description}`);
        });
      }
      
      if (infoIssues.length > 0) {
        console.log(`\nℹ️  信息 (${infoIssues.length}):`);
        infoIssues.forEach((issue, i) => {
          console.log(`   ${i + 1}. [${issue.category}] ${issue.description}`);
        });
      }
    }
  });
});

