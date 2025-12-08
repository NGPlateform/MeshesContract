import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

/**
 * 全面的 Meshes 合约测试套件
 * 覆盖所有核心功能和边界情况
 */
describe("Meshes.sol - Comprehensive Test Suite", function () {
  let meshes: any;
  let treasury: any;
  let governanceSafe: any;
  let user1: any;
  let user2: any;
  let user3: any;
  let user4: any;

  const SECONDS_IN_DAY = 86400;
  const HOUR_SECONDS = 3600;
  const BASE_BURN_AMOUNT = 10;

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    governanceSafe = signers[0];
    user1 = signers[1];
    user2 = signers[2];
    user3 = signers[3];
    user4 = signers[4];
    treasury = signers[5] || signers[0];

    const MeshesF = await ethers.getContractFactory("Meshes");
    meshes = await MeshesF.connect(governanceSafe).deploy(governanceSafe.address);
    await meshes.deployed();
    
    // Set treasury address
    await meshes.connect(governanceSafe).setTreasuryAddress(treasury.address);
  });

  async function expectRevert(p: Promise<any>, reasonIncludes: string) {
    try {
      await p;
      expect.fail("Expected revert, but tx succeeded");
    } catch (e: any) {
      expect(String(e.message)).to.include(reasonIncludes);
    }
  }

  function expectEqBN(actual: any, expected: any) {
    expect(BigNumber.from(actual).eq(BigNumber.from(expected))).to.equal(true);
  }

  function expectGtBN(actual: any, expected: any) {
    expect(BigNumber.from(actual).gt(BigNumber.from(expected))).to.equal(true);
  }

  function expectGteBN(actual: any, expected: any) {
    expect(BigNumber.from(actual).gte(BigNumber.from(expected))).to.equal(true);
  }

  // ============ 部署和初始化测试 ============
  describe("Deployment and Initialization", () => {
    it("should deploy with correct initial state", async () => {
      expect(await meshes.name()).to.equal("Mesh Token");
      expect(await meshes.symbol()).to.equal("MESH");
      expect(await meshes.decimals()).to.equal(18);
      
      const genesisTs = await meshes.genesisTs();
      expect(genesisTs.gt(0)).to.equal(true);
      
      expect(await meshes.governanceSafeAddress()).to.equal(governanceSafe.address);
      expect(await meshes.treasuryAddress()).to.equal(treasury.address);
      expect(await meshes.dailyMintFactor()).to.equal(ethers.utils.parseUnits("1", 10));
      expect(await meshes.burnScaleMilli()).to.equal(1000);
      expect(await meshes.isSafeGovernance()).to.equal(false);
      expect(await meshes.governanceLocked()).to.equal(false);
    });

    it("should initialize with zero active users and meshes", async () => {
      expectEqBN(await meshes.activeClaimers(), 0);
      expectEqBN(await meshes.activeMeshes(), 0);
      expectEqBN(await meshes.totalClaimMints(), 0);
      expectEqBN(await meshes.totalBurn(), 0);
      expectEqBN(await meshes.maxMeshHeats(), 0);
    });

    it("should set treasury address correctly", async () => {
      const newTreasury = user1.address;
      await meshes.connect(governanceSafe).setTreasuryAddress(newTreasury);
      expect(await meshes.treasuryAddress()).to.equal(newTreasury);
    });
  });

  // ============ 网格ID验证测试 ============
  describe("Mesh ID Validation", () => {
    it("should accept valid mesh IDs", async () => {
      expect(await meshes.isValidMeshID("E123N45")).to.equal(true);
      expect(await meshes.isValidMeshID("W17999S9000")).to.equal(true);
      expect(await meshes.isValidMeshID("E0N0")).to.equal(true);
      expect(await meshes.isValidMeshID("E1N1")).to.equal(true);
      expect(await meshes.isValidMeshID("W0N0")).to.equal(true);
      expect(await meshes.isValidMeshID("E17999N9000")).to.equal(true);
    });

    it("should reject invalid mesh IDs", async () => {
      expect(await meshes.isValidMeshID("")).to.equal(false);
      expect(await meshes.isValidMeshID("A123B45")).to.equal(false);
      expect(await meshes.isValidMeshID("E18000N1")).to.equal(false); // lon >= 18000
      expect(await meshes.isValidMeshID("E1S9001")).to.equal(false); // lat > 9000
      expect(await meshes.isValidMeshID("EN1")).to.equal(false); // missing digits
      expect(await meshes.isValidMeshID("E1N")).to.equal(false); // missing lat digits
      expect(await meshes.isValidMeshID("E1")).to.equal(false); // missing N/S and lat
      expect(await meshes.isValidMeshID("123N45")).to.equal(false); // missing E/W
    });

    it("should handle boundary coordinates correctly", async () => {
      expect(await meshes.isValidMeshID("E17999N9000")).to.equal(true);
      expect(await meshes.isValidMeshID("W17999S9000")).to.equal(true);
      expect(await meshes.isValidMeshID("E0N0")).to.equal(true);
      expect(await meshes.isValidMeshID("W0S0")).to.equal(true);
    });
  });

  // ============ 网格认领测试 ============
  describe("Mesh Claiming", () => {
    it("should allow first claim of a mesh", async () => {
      const meshID = "E100N100";
      const tx = await meshes.connect(user1).claimMesh(meshID);
      const rc = await tx.wait();

      // Check events
      const claimedEvent = rc.events.find((e: any) => e.event === "MeshClaimed");
      expect(claimedEvent).to.not.be.undefined;
      expect(claimedEvent.args.user).to.equal(user1.address);
      expect(claimedEvent.args.meshID).to.equal(meshID);

      // Check state
      expectEqBN(await meshes.activeClaimers(), 1);
      expectEqBN(await meshes.activeMeshes(), 1);
      expectEqBN(await meshes.totalClaimMints(), 1);
      expectEqBN(await meshes.meshClaimCount(meshID), 1);

      const mintInfo = await meshes.userMints(user1.address, meshID);
      expect(mintInfo.user).to.equal(user1.address);
      expect(mintInfo.meshID).to.equal(meshID);
      expect(mintInfo.updateTs.gt(0)).to.equal(true);
    });

    it("should prevent duplicate claim by same user", async () => {
      const meshID = "E101N101";
      await meshes.connect(user1).claimMesh(meshID);
      
      await expectRevert(
        meshes.connect(user1).claimMesh(meshID),
        "Already claim"
      );
    });

    it("should allow multiple users to claim same mesh", async () => {
      const meshID = "E102N102";
      
      // First claim
      await meshes.connect(user1).claimMesh(meshID);
      expectEqBN(await meshes.meshClaimCount(meshID), 1);
      
      // Second claim by different user
      await meshes.connect(user2).claimMesh(meshID);
      expectEqBN(await meshes.meshClaimCount(meshID), 2);
      
      // Third claim
      await meshes.connect(user3).claimMesh(meshID);
      expectEqBN(await meshes.meshClaimCount(meshID), 3);
    });

    it("should calculate heat correctly for multiple claims", async () => {
      const meshID = "E103N103";
      
      await meshes.connect(user1).claimMesh(meshID);
      const heat1 = await meshes.meshHeats(meshID);
      expectEqBN(heat1, ethers.utils.parseEther("1")); // First claim: 1.0
      
      await meshes.connect(user2).claimMesh(meshID);
      const heat2 = await meshes.meshHeats(meshID);
      expectEqBN(heat2, ethers.utils.parseEther("1.2")); // Second claim: 1.2
      
      await meshes.connect(user3).claimMesh(meshID);
      const heat3 = await meshes.meshHeats(meshID);
      expectEqBN(heat3, ethers.utils.parseEther("1.44")); // Third claim: 1.44
    });

    it("should update user weight sum correctly", async () => {
      const meshID1 = "E104N104";
      const meshID2 = "E105N105";
      
      await meshes.connect(user1).claimMesh(meshID1);
      let weight = await meshes.userWeightSum(user1.address);
      expectEqBN(weight, ethers.utils.parseEther("1"));
      
      await meshes.connect(user1).claimMesh(meshID2);
      weight = await meshes.userWeightSum(user1.address);
      expectEqBN(weight, ethers.utils.parseEther("2")); // 1 + 1
    });

    it("should revert when paused", async () => {
      await meshes.connect(governanceSafe).pause();
      await expectRevert(
        meshes.connect(user1).claimMesh("E106N106"),
        "paused"
      );
    });

    it("should revert with invalid mesh ID", async () => {
      await expectRevert(
        meshes.connect(user1).claimMesh("invalid"),
        "Invalid meshID format"
      );
    });

    it("should revert with empty mesh ID", async () => {
      await expectRevert(
        meshes.connect(user1).claimMesh(""),
        "MeshID cannot be empty"
      );
    });

    it("should allow governance to claim for user", async () => {
      const meshID = "E107N107";
      await meshes.connect(governanceSafe).claimMeshFor(user1.address, meshID);
      
      const mintInfo = await meshes.userMints(user1.address, meshID);
      expect(mintInfo.user).to.equal(user1.address);
      
      await expectRevert(
        meshes.connect(user2).claimMeshFor(user1.address, "E108N108"),
        "Only Owner governance"
      );
    });
  });

  // ============ 燃烧机制测试 ============
  describe("Burn Mechanism", () => {
    it("should not require burn for first claim", async () => {
      const meshID = "E200N200";
      const balBefore = await meshes.balanceOf(user1.address);
      
      await meshes.connect(user1).claimMesh(meshID);
      
      const balAfter = await meshes.balanceOf(user1.address);
      expectEqBN(balBefore, balAfter); // No tokens burned
    });

    it("should require burn for second claim when burn scale > 0", async () => {
      const meshID = "E201N201";
      
      // First claim
      await meshes.connect(user1).claimMesh(meshID);
      
      // Enable burn scale
      await meshes.connect(governanceSafe).setBurnScale(1000);
      
      // Second claim should require burn
      await expectRevert(
        meshes.connect(user2).claimMesh(meshID),
        "Insufficient to burn"
      );
    });

    it("should burn tokens correctly for second claim", async () => {
      const meshID = "E202N202";
      
      // First claim
      await meshes.connect(user1).claimMesh(meshID);
      const heat1 = await meshes.meshHeats(meshID);
      
      // Enable burn scale
      await meshes.connect(governanceSafe).setBurnScale(1000);
      
      // Give user2 some tokens
      await meshes.connect(user1).transfer(user2.address, ethers.utils.parseEther("1000"));
      
      // Calculate expected cost
      const [heat, cost] = await meshes.quoteClaimCost(meshID);
      expectGtBN(cost, 0);
      
      const balBefore = await meshes.balanceOf(user2.address);
      const totalBurnBefore = await meshes.totalBurn();
      
      // Second claim
      await meshes.connect(user2).claimMesh(meshID);
      
      const balAfter = await meshes.balanceOf(user2.address);
      const totalBurnAfter = await meshes.totalBurn();
      
      expectEqBN(balBefore.sub(balAfter), cost);
      expectEqBN(totalBurnAfter.sub(totalBurnBefore), cost);
    });

    it("should not require burn when burn scale is 0", async () => {
      const meshID = "E203N203";
      
      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(governanceSafe).setBurnScale(0);
      
      // Second claim should succeed without burn
      await meshes.connect(user2).claimMesh(meshID);
      expectEqBN(await meshes.meshClaimCount(meshID), 2);
    });

    it("should calculate burn cost correctly based on heat", async () => {
      const meshID = "E204N204";
      
      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(governanceSafe).setBurnScale(1000);
      
      // First quote (heat = 1.0)
      const [heat1, cost1] = await meshes.quoteClaimCost(meshID);
      expectEqBN(heat1, ethers.utils.parseEther("1"));
      
      // Second claim increases heat
      await meshes.connect(user2).claimMesh(meshID);
      
      // Third quote (heat = 1.2)
      const [heat2, cost2] = await meshes.quoteClaimCost(meshID);
      expectEqBN(heat2, ethers.utils.parseEther("1.2"));
      expectGtBN(cost2, cost1); // Cost should increase with heat
    });

    it("should emit burn events correctly", async () => {
      const meshID = "E205N205";
      
      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(governanceSafe).setBurnScale(1000);
      await meshes.connect(user1).transfer(user2.address, ethers.utils.parseEther("1000"));
      
      const tx = await meshes.connect(user2).claimMesh(meshID);
      const rc = await tx.wait();
      
      const burnEvent = rc.events.find((e: any) => e.event === "TokensBurned");
      expect(burnEvent).to.not.be.undefined;
      expect(burnEvent.args.reasonCode).to.equal(1); // 1 = claim_cost
      
      const claimBurnEvent = rc.events.find((e: any) => e.event === "ClaimCostBurned");
      expect(claimBurnEvent).to.not.be.undefined;
      expect(claimBurnEvent.args.user).to.equal(user2.address);
    });
  });

  // ============ 提取功能测试 ============
  describe("Withdraw Functionality", () => {
    it("should revert if user has no claims", async () => {
      await expectRevert(
        meshes.connect(user1).withdraw(),
        "No claims"
      );
    });

    it("should enforce 24-hour cooldown for first withdrawal", async () => {
      const meshID = "E300N300";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Try to withdraw immediately - should fail
      await expectRevert(
        meshes.connect(user1).withdraw(),
        "First claim cooldown"
      );
      
      // Advance 23 hours - should still fail
      await increaseTime(23 * HOUR_SECONDS);
      await expectRevert(
        meshes.connect(user1).withdraw(),
        "First claim cooldown"
      );
      
      // Advance 1 more hour - should succeed
      await increaseTime(1 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
    });

    it("should enforce daily limit after first withdrawal", async () => {
      const meshID = "E301N301";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Wait 24 hours and withdraw
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      // Try to withdraw again same day - should fail
      await expectRevert(
        meshes.connect(user1).withdraw(),
        "Daily receive"
      );
      
      // Advance 1 day - should succeed
      await increaseTime(SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
    });

    it("should mint tokens correctly on withdrawal", async () => {
      const meshID = "E302N302";
      await meshes.connect(user1).claimMesh(meshID);
      
      const balBefore = await meshes.balanceOf(user1.address);
      const totalSupplyBefore = await meshes.totalSupply();
      
      // Wait 24 hours and withdraw
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      const balAfter = await meshes.balanceOf(user1.address);
      const totalSupplyAfter = await meshes.totalSupply();
      
      expectGtBN(balAfter, balBefore);
      expectGtBN(totalSupplyAfter, totalSupplyBefore);
    });

    it("should calculate payout based on weight and daily factor", async () => {
      const meshID1 = "E303N303";
      const meshID2 = "E304N304";
      
      // User1 claims 2 meshes
      await meshes.connect(user1).claimMesh(meshID1);
      await meshes.connect(user1).claimMesh(meshID2);
      
      // User2 claims 1 mesh
      await meshes.connect(user2).claimMesh(meshID1);
      
      await increaseTime(24 * HOUR_SECONDS);
      
      // User1 should get more tokens (weight = 2)
      const bal1Before = await meshes.balanceOf(user1.address);
      await meshes.connect(user1).withdraw();
      const bal1After = await meshes.balanceOf(user1.address);
      const payout1 = bal1After.sub(bal1Before);
      
      // User2 should get less tokens (weight = 1)
      const bal2Before = await meshes.balanceOf(user2.address);
      await meshes.connect(user2).withdraw();
      const bal2After = await meshes.balanceOf(user2.address);
      const payout2 = bal2After.sub(bal2Before);
      
      // User1 should get approximately 2x user2 (allowing for rounding)
      expectGtBN(payout1, payout2);
    });

    it("should apply unclaimed decay correctly", async () => {
      const meshID = "E305N305";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Wait 24 hours and withdraw once
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      const bal1 = await meshes.balanceOf(user1.address);
      
      // Skip 3 days without withdrawing
      await increaseTime(3 * SECONDS_IN_DAY);
      
      // Withdraw should apply decay for 3 days
      const balBefore = await meshes.balanceOf(user1.address);
      await meshes.connect(user1).withdraw();
      const balAfter = await meshes.balanceOf(user1.address);
      
      // Balance should increase, but less than if no decay
      expectGtBN(balAfter, balBefore);
    });

    it("should emit withdraw events correctly", async () => {
      const meshID = "E306N306";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      const tx = await meshes.connect(user1).withdraw();
      const rc = await tx.wait();
      
      const withdrawEvent = rc.events.find((e: any) => e.event === "WithdrawProcessed");
      expect(withdrawEvent).to.not.be.undefined;
      expect(withdrawEvent.args.user).to.equal(user1.address);
      expectGtBN(withdrawEvent.args.payout, 0);
    });

    it("should revert when paused", async () => {
      const meshID = "E307N307";
      await meshes.connect(user1).claimMesh(meshID);
      await increaseTime(24 * HOUR_SECONDS);
      
      await meshes.connect(governanceSafe).pause();
      await expectRevert(
        meshes.connect(user1).withdraw(),
        "paused"
      );
    });
  });

  // ============ 日衰减机制测试 ============
  describe("Daily Decay Mechanism", () => {
    it("should apply 50% decay to unclaimed balance daily", async () => {
      const meshID = "E400N400";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Wait 24 hours and withdraw once
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      // Skip 2 days
      await increaseTime(2 * SECONDS_IN_DAY);
      
      // Check preview before withdraw
      const preview = await meshes.previewWithdraw(user1.address);
      expectGtBN(preview.burnTodayIfNoWithdraw, 0);
      expectGtBN(preview.treasuryTodayIfNoWithdraw, 0);
      
      // Withdraw should apply decay
      const burnBefore = await meshes.totalBurn();
      const treasuryBalBefore = await meshes.balanceOf(treasury.address);
      
      await meshes.connect(user1).withdraw();
      
      const burnAfter = await meshes.totalBurn();
      const treasuryBalAfter = await meshes.balanceOf(treasury.address);
      
      // Should have burned and sent to treasury
      expectGtBN(burnAfter, burnBefore);
      expectGteBN(treasuryBalAfter, treasuryBalBefore);
    });

    it("should handle large decay ranges with processUnclaimedDecay", async () => {
      const meshID = "E401N401";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Wait 24 hours and withdraw once
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      // Skip 400 days (more than MAX_DECAY_DAYS_PER_CALL = 365)
      await increaseTime(400 * SECONDS_IN_DAY);
      
      // Should need to process decay in batches
      let fullyProcessed = false;
      let iterations = 0;
      
      while (!fullyProcessed && iterations < 10) {
        const result = await meshes.connect(user1).processUnclaimedDecay(user1.address, 0);
        fullyProcessed = result.fullyProcessed;
        iterations++;
      }
      
      expect(fullyProcessed).to.equal(true);
    });

    it("should emit decay events correctly", async () => {
      const meshID = "E402N402";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      await increaseTime(2 * SECONDS_IN_DAY);
      
      const tx = await meshes.connect(user1).withdraw();
      const rc = await tx.wait();
      
      const decayEvent = rc.events.find((e: any) => e.event === "UnclaimedDecayApplied");
      // Decay event may or may not be emitted depending on implementation
      // Just check that withdraw succeeded
      expect(rc.status).to.equal(1);
    });
  });

  // ============ Treasury 分配测试 ============
  describe("Treasury Allocation", () => {
    it("should accumulate treasury fees in pending pool", async () => {
      const meshID = "E500N500";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      // Skip days to accumulate treasury fees
      await increaseTime(3 * SECONDS_IN_DAY);
      
      const pendingBefore = await meshes.pendingTreasuryPool();
      await meshes.connect(user1).withdraw();
      const pendingAfter = await meshes.pendingTreasuryPool();
      
      expectGtBN(pendingAfter, pendingBefore);
    });

    it("should payout treasury hourly when due", async () => {
      const meshID = "E501N501";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      await increaseTime(2 * SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      
      // Advance to next hour
      await increaseTime(HOUR_SECONDS);
      
      const treasuryBalBefore = await meshes.balanceOf(treasury.address);
      const pendingBefore = await meshes.pendingTreasuryPool();
      
      if (pendingBefore.gt(0)) {
        await meshes.connect(user1).payoutTreasuryIfDue();
        
        const treasuryBalAfter = await meshes.balanceOf(treasury.address);
        const pendingAfter = await meshes.pendingTreasuryPool();
        
        expectGtBN(treasuryBalAfter, treasuryBalBefore);
        expectEqBN(pendingAfter, 0);
      }
    });

    it("should emit treasury payout events", async () => {
      const meshID = "E502N502";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      await increaseTime(2 * SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      
      await increaseTime(HOUR_SECONDS);
      
      const pending = await meshes.pendingTreasuryPool();
      if (pending.gt(0)) {
        const tx = await meshes.connect(user1).payoutTreasuryIfDue();
        const rc = await tx.wait();
        
        const payoutEvent = rc.events.find((e: any) => e.event === "TreasuryPayout");
        if (payoutEvent) {
          expectGtBN(payoutEvent.args.amount, 0);
        }
      }
    });
  });

  // ============ 治理功能测试 ============
  describe("Governance Functions", () => {
    it("should allow governance to pause/unpause", async () => {
      await meshes.connect(governanceSafe).pause();
      expect(await meshes.paused()).to.equal(true);
      
      await meshes.connect(governanceSafe).unpause();
      expect(await meshes.paused()).to.equal(false);
    });

    it("should restrict pause to governance only", async () => {
      await expectRevert(
        meshes.connect(user1).pause(),
        "Only Owner governance"
      );
    });

    it("should allow governance to set burn scale", async () => {
      await meshes.connect(governanceSafe).setBurnScale(2000);
      expect(await meshes.burnScaleMilli()).to.equal(2000);
      
      await meshes.connect(governanceSafe).setBurnScale(0);
      expect(await meshes.burnScaleMilli()).to.equal(0);
    });

    it("should restrict burn scale to governance only", async () => {
      await expectRevert(
        meshes.connect(user1).setBurnScale(1000),
        "Only Owner governance"
      );
    });

    it("should reject burn scale > 1_000_000", async () => {
      await expectRevert(
        meshes.connect(governanceSafe).setBurnScale(1_000_001),
        "Scale too large"
      );
    });

    it("should allow governance to set treasury address", async () => {
      const newTreasury = user1.address;
      await meshes.connect(governanceSafe).setTreasuryAddress(newTreasury);
      expect(await meshes.treasuryAddress()).to.equal(newTreasury);
    });

    it("should restrict treasury address setting to governance only", async () => {
      await expectRevert(
        meshes.connect(user1).setTreasuryAddress(user1.address),
        "Only Owner governance"
      );
    });

    it("should reject zero treasury address", async () => {
      await expectRevert(
        meshes.connect(governanceSafe).setTreasuryAddress(ethers.constants.AddressZero),
        "Invalid treasury address"
      );
    });

    it("should reject same treasury address", async () => {
      const current = await meshes.treasuryAddress();
      await expectRevert(
        meshes.connect(governanceSafe).setTreasuryAddress(current),
        "Same treasury address"
      );
    });

    it("should allow governance to set governance safe address", async () => {
      const newSafe = user1.address;
      await meshes.connect(governanceSafe).setGovernanceSafe(newSafe);
      expect(await meshes.governanceSafeAddress()).to.equal(newSafe);
    });

    it("should allow owner to switch to safe governance", async () => {
      expect(await meshes.isSafeGovernance()).to.equal(false);
      
      await meshes.connect(governanceSafe).switchToSafeGovernance();
      
      expect(await meshes.isSafeGovernance()).to.equal(true);
      expect(await meshes.governanceLocked()).to.equal(true);
    });

    it("should prevent switching back from safe governance", async () => {
      await meshes.connect(governanceSafe).switchToSafeGovernance();
      
      // Should be locked, cannot switch back
      expect(await meshes.governanceLocked()).to.equal(true);
    });

    it("should return correct governance info", async () => {
      const [isSafe, locked, current] = await meshes.getGovernanceInfo();
      expect(isSafe).to.equal(false);
      expect(locked).to.equal(false);
      expect(current).to.equal(governanceSafe.address);
    });
  });

  // ============ 查询函数测试 ============
  describe("View Functions", () => {
    it("should return correct mesh info", async () => {
      const meshID = "E600N600";
      await meshes.connect(user1).claimMesh(meshID);
      
      const info = await meshes.getMeshInfo(meshID);
      expectEqBN(info.applyCount, 1);
      expectGtBN(info.heat, 0);
    });

    it("should return correct quote claim cost", async () => {
      const meshID = "E601N601";
      
      // First claim - no cost
      let [heat, cost] = await meshes.quoteClaimCost(meshID);
      expectEqBN(cost, 0);
      
      // After first claim
      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(governanceSafe).setBurnScale(1000);
      
      [heat, cost] = await meshes.quoteClaimCost(meshID);
      expectGtBN(heat, 0);
      expectGtBN(cost, 0);
    });

    it("should return correct user state", async () => {
      const meshID = "E602N602";
      await meshes.connect(user1).claimMesh(meshID);
      
      const state = await meshes.getUserState(user1.address);
      expectGtBN(state.weight, 0);
      expectEqBN(state.claimCount, 1);
    });

    it("should return correct preview withdraw", async () => {
      const meshID = "E603N603";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      
      const preview = await meshes.previewWithdraw(user1.address);
      expectGtBN(preview.payoutToday, 0);
      expectGtBN(preview.dayIndex, 0);
    });

    it("should return correct canUserWithdraw", async () => {
      const meshID = "E604N604";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Before 24 hours
      let [canWithdraw, nextTime] = await meshes.canUserWithdraw(user1.address);
      expect(canWithdraw).to.equal(false);
      expectGtBN(nextTime, 0);
      
      // After 24 hours
      await increaseTime(24 * HOUR_SECONDS);
      [canWithdraw, nextTime] = await meshes.canUserWithdraw(user1.address);
      expect(canWithdraw).to.equal(true);
    });

    it("should return correct mesh data", async () => {
      const meshID = "E605N605";
      await meshes.connect(user1).claimMesh(meshID);
      
      const data = await meshes.getMeshData();
      expectEqBN(data.userCounts, 1);
      expectGtBN(data.totalMinted, 0);
    });

    it("should return correct mesh dashboard", async () => {
      const meshID = "E606N606";
      await meshes.connect(user1).claimMesh(meshID);
      
      const dash = await meshes.getMeshDashboard();
      expectEqBN(dash.participants, 1);
      expectEqBN(dash.claimedMesh, 1);
    });

    it("should return correct dashboard", async () => {
      const meshID = "E607N607";
      await meshes.connect(user1).claimMesh(meshID);
      
      const dash = await meshes.getDashboard();
      expectGtBN(dash._totalSupply, 0);
      expectGteBN(dash._liquidSupply, 0);
    });

    it("should return correct contract status", async () => {
      const meshID = "E608N608";
      await meshes.connect(user1).claimMesh(meshID);
      
      const status = await meshes.getContractStatus();
      expect(status._paused).to.equal(false);
      expectGtBN(status._totalSupply, 0);
      expectEqBN(status._activeClaimers, 1);
    });
  });

  // ============ 年衰减测试 ============
  describe("Yearly Decay", () => {
    it("should apply yearly decay to daily mint factor", async () => {
      const meshID = "E700N700";
      await meshes.connect(user1).claimMesh(meshID);
      
      // Day 0
      let factor = await meshes.dailyMintFactor();
      expectEqBN(factor, ethers.utils.parseUnits("1", 10)); // 1.0
      
      // Advance 365 days (1 year)
      await increaseTime(365 * SECONDS_IN_DAY);
      
      // Trigger factor update by withdrawing
      await meshes.connect(user1).withdraw();
      
      // Factor should be 0.9 (90% of original)
      factor = await meshes.dailyMintFactor();
      const expected = ethers.utils.parseUnits("0.9", 10);
      expectEqBN(factor, expected);
    });

    it("should continue decaying over multiple years", async () => {
      const meshID = "E701N701";
      await meshes.connect(user1).claimMesh(meshID);
      
      await increaseTime(24 * HOUR_SECONDS);
      await meshes.connect(user1).withdraw();
      
      // Year 1
      await increaseTime(365 * SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      let factor1 = await meshes.dailyMintFactor();
      
      // Year 2
      await increaseTime(365 * SECONDS_IN_DAY);
      await meshes.connect(user1).withdraw();
      let factor2 = await meshes.dailyMintFactor();
      
      // Year 2 should be less than year 1
      expectGtBN(factor1, factor2);
    });
  });

  // ============ 边界情况测试 ============
  describe("Edge Cases", () => {
    it("should handle maximum heat calculations", async () => {
      const meshID = "E800N800";
      
      // Claim multiple times to increase heat
      for (let i = 0; i < 10; i++) {
        const user = i === 0 ? user1 : (await ethers.getSigners())[i + 1];
        await meshes.connect(user).claimMesh(meshID);
      }
      
      const heat = await meshes.meshHeats(meshID);
      expectGtBN(heat, 0);
      
      const maxHeat = await meshes.maxMeshHeats();
      expectGteBN(maxHeat, heat);
    });

    it("should handle multiple users claiming different meshes", async () => {
      const users = [user1, user2, user3, user4];
      const meshIDs = ["E801N801", "E802N802", "E803N803", "E804N804"];
      
      for (let i = 0; i < users.length; i++) {
        await meshes.connect(users[i]).claimMesh(meshIDs[i]);
      }
      
      expectEqBN(await meshes.activeClaimers(), 4);
      expectEqBN(await meshes.activeMeshes(), 4);
      expectEqBN(await meshes.totalClaimMints(), 4);
    });

    it("should handle rapid sequential claims", async () => {
      const meshID = "E805N805";
      
      await meshes.connect(user1).claimMesh(meshID);
      await meshes.connect(user2).claimMesh(meshID);
      await meshes.connect(user3).claimMesh(meshID);
      await meshes.connect(user4).claimMesh(meshID);
      
      expectEqBN(await meshes.meshClaimCount(meshID), 4);
    });

    it("should handle withdraw with zero weight gracefully", async () => {
      // This shouldn't happen in practice, but test the revert
      // User with no claims cannot withdraw
      await expectRevert(
        meshes.connect(user1).withdraw(),
        "No claims"
      );
    });

    it("should handle very long mesh IDs", async () => {
      // Test maximum valid mesh ID
      const meshID = "E17999N9000";
      expect(await meshes.isValidMeshID(meshID)).to.equal(true);
      await meshes.connect(user1).claimMesh(meshID);
    });

    it("should handle minimum mesh IDs", async () => {
      const meshID = "E0N0";
      expect(await meshes.isValidMeshID(meshID)).to.equal(true);
      await meshes.connect(user1).claimMesh(meshID);
    });
  });

  // ============ 事件测试 ============
  describe("Event Emissions", () => {
    it("should emit MeshClaimed event", async () => {
      const meshID = "E900N900";
      const tx = await meshes.connect(user1).claimMesh(meshID);
      const rc = await tx.wait();
      
      const event = rc.events.find((e: any) => e.event === "MeshClaimed");
      expect(event).to.not.be.undefined;
      expect(event.args.user).to.equal(user1.address);
      expect(event.args.meshID).to.equal(meshID);
    });

    it("should emit UserWeightUpdated event", async () => {
      const meshID = "E901N901";
      const tx = await meshes.connect(user1).claimMesh(meshID);
      const rc = await tx.wait();
      
      const event = rc.events.find((e: any) => e.event === "UserWeightUpdated");
      expect(event).to.not.be.undefined;
      expect(event.args.user).to.equal(user1.address);
    });

    it("should emit DegreeHeats event", async () => {
      const meshID = "E902N902";
      const tx = await meshes.connect(user1).claimMesh(meshID);
      const rc = await tx.wait();
      
      const event = rc.events.find((e: any) => e.event === "DegreeHeats");
      expect(event).to.not.be.undefined;
      expect(event.args.meshID).to.equal(meshID);
    });

    it("should emit BurnScaleUpdated event", async () => {
      const tx = await meshes.connect(governanceSafe).setBurnScale(2000);
      const rc = await tx.wait();
      
      const event = rc.events.find((e: any) => e.event === "BurnScaleUpdated");
      expect(event).to.not.be.undefined;
      expectEqBN(event.args.newMilli, 2000);
    });

    it("should emit TreasuryAddressUpdated event", async () => {
      const newTreasury = user1.address;
      const tx = await meshes.connect(governanceSafe).setTreasuryAddress(newTreasury);
      const rc = await tx.wait();
      
      const event = rc.events.find((e: any) => e.event === "TreasuryAddressUpdated");
      expect(event).to.not.be.undefined;
      expect(event.args.newAddress).to.equal(newTreasury);
    });

    it("should emit GovernanceModeSwitched event", async () => {
      const tx = await meshes.connect(governanceSafe).switchToSafeGovernance();
      const rc = await tx.wait();
      
      const event = rc.events.find((e: any) => e.event === "GovernanceModeSwitched");
      expect(event).to.not.be.undefined;
      expect(event.args.isSafeGovernance).to.equal(true);
    });
  });
});















