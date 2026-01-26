// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TeamBattle - 蓝橙对抗模式合约
 * @dev 独立合约实现团队归属、攻防与热度机制
 */
contract TeamBattle is Ownable, ReentrancyGuard, Pausable {
    enum Team {
        None,
        Blue,
        Orange
    }

    // ============ 常量 ============
    uint256 private constant HEAT_OFFSET = 1_000_000;
    uint256 private constant BASE_BURN_AMOUNT = 10;
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ============ 配置 ============
    IERC20 public meshToken;
    uint256 public burnScaleMilli = 1000;
    uint256 public attackBaseCost = 100;
    uint256 public attackMultiplierMilli = 2500; // 2.5x

    // ============ 治理 ============
    address public governanceSafeAddress;
    bool public isSafeGovernance = false;
    bool public governanceLocked = false;

    // ============ 数据 ============
    mapping(string => uint256) private meshHeats;
    mapping(string => int256) private meshClaimCounts;
    mapping(string => bool) private meshEverClaimed;
    mapping(address => Team) public userTeams;
    mapping(address => uint256) public pointsBalance;
    uint256 public totalBurn;

    // ============ 事件 ============
    event TeamAssigned(address indexed user, Team team);
    event MeshClaimed(
        address indexed user,
        string indexed meshID,
        Team team,
        int256 heat,
        int256 claimCount,
        uint256 costBurned
    );
    event MeshAttacked(
        address indexed user,
        string indexed meshID,
        Team attackerTeam,
        Team defenderTeam,
        uint256 heatBefore,
        uint256 heatAfter,
        uint256 costPoints,
        bool neutralized
    );
    event MeshCaptured(
        address indexed user,
        string indexed meshID,
        Team team,
        int256 heat,
        int256 claimCount,
        uint256 costBurned
    );
    event PointsGranted(address indexed to, uint256 amount);
    event PointsRevoked(address indexed from, uint256 amount);
    event PointsSpent(address indexed user, uint256 amount);
    event BurnScaleUpdated(uint256 indexed oldMilli, uint256 indexed newMilli);
    event AttackConfigUpdated(uint256 baseCost, uint256 multiplierMilli);
    event TokensBurned(uint256 amount, uint8 reasonCode); // 1=claim_cost
    event ClaimCostBurned(address indexed user, string indexed meshID, uint256 amount);
    event GovernanceSafeUpdated(address indexed oldSafe, address indexed newSafe);
    event GovernanceModeSwitched(bool indexed isSafeGovernance, address indexed caller, uint256 timestamp);
    event GovernanceModeLocked(bool indexed isSafeGovernance, address indexed caller, uint256 timestamp);

    // ============ 访问控制修饰符 ============
    modifier onlySafe() {
        require(msg.sender == governanceSafeAddress, "Only Safe");
        _;
    }

    modifier onlyGovernance() {
        if (isSafeGovernance) {
            require(msg.sender == governanceSafeAddress, "Only Safe governance");
        } else {
            require(msg.sender == owner(), "Only Owner governance");
        }
        _;
    }

    modifier onlyContractOwner() {
        require(msg.sender == owner(), "Only Owner");
        _;
    }

    constructor(address _meshToken, address _governanceSafeAddress) {
        require(_meshToken != address(0), "Invalid mesh token");
        require(_governanceSafeAddress != address(0), "Invalid safe address");
        meshToken = IERC20(_meshToken);
        governanceSafeAddress = _governanceSafeAddress;
    }

    // ============ 治理配置 ============
    function setBurnScale(uint256 _milli) external onlyGovernance whenNotPaused {
        require(_milli <= 1_000_000, "Scale too large");
        uint256 old = burnScaleMilli;
        burnScaleMilli = _milli;
        emit BurnScaleUpdated(old, _milli);
    }

    function setAttackConfig(uint256 _baseCost, uint256 _multiplierMilli)
        external
        onlyGovernance
        whenNotPaused
    {
        require(_multiplierMilli > 0, "Invalid multiplier");
        attackBaseCost = _baseCost;
        attackMultiplierMilli = _multiplierMilli;
        emit AttackConfigUpdated(_baseCost, _multiplierMilli);
    }

    function setGovernanceSafe(address _newSafe) external onlyGovernance whenNotPaused {
        require(_newSafe != address(0), "Invalid safe");
        require(_newSafe != governanceSafeAddress, "Same safe");
        address old = governanceSafeAddress;
        governanceSafeAddress = _newSafe;
        emit GovernanceSafeUpdated(old, _newSafe);
    }

    function switchToSafeGovernance() external onlyContractOwner whenNotPaused {
        require(!governanceLocked, "Governance already locked");
        require(governanceSafeAddress != address(0), "Safe address not set");
        require(!isSafeGovernance, "Already in Safe governance");

        isSafeGovernance = true;
        governanceLocked = true;

        emit GovernanceModeSwitched(true, msg.sender, block.timestamp);
        emit GovernanceModeLocked(true, msg.sender, block.timestamp);
    }

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
    }

    // ============ Points 管理 ============
    function grantPoints(address to, uint256 amount) external onlyGovernance whenNotPaused {
        require(to != address(0), "Invalid address");
        require(amount > 0, "Zero amount");
        pointsBalance[to] += amount;
        emit PointsGranted(to, amount);
    }

    function revokePoints(address from, uint256 amount) external onlyGovernance whenNotPaused {
        require(from != address(0), "Invalid address");
        require(amount > 0, "Zero amount");
        require(pointsBalance[from] >= amount, "Insufficient points");
        pointsBalance[from] -= amount;
        emit PointsRevoked(from, amount);
    }

    // ============ 核心业务 ============
    function claimMesh(string calldata _meshID, Team _team)
        external
        nonReentrant
        whenNotPaused
    {
        require(_team == Team.Blue || _team == Team.Orange, "Invalid team");
        require(isValidMeshID(_meshID), "Invalid meshID format");

        _ensureUserTeam(msg.sender, _team);

        (int256 heat, Team meshTeam) = _decodeHeat(meshHeats[_meshID]);
        require(heat == 0 || meshTeam == _team, "Enemy mesh");

        uint256 costBurned = 0;
        if (heat == 0) {
            require(!meshEverClaimed[_meshID], "Use captureMesh");
        } else {
            uint256 absHeat = _abs(heat);
            costBurned = _calculateClaimCost(absHeat);
        }

        _burnClaimCost(msg.sender, _meshID, costBurned);

        int256 newHeat = heat + (_team == Team.Blue ? int256(1) : int256(-1));
        meshHeats[_meshID] = _encodeHeat(newHeat);
        if (heat == 0) {
            meshClaimCounts[_meshID] = _team == Team.Blue ? int256(1) : int256(-1);
        } else {
            meshClaimCounts[_meshID] += _team == Team.Blue ? int256(1) : int256(-1);
        }
        meshEverClaimed[_meshID] = true;

        emit MeshClaimed(msg.sender, _meshID, _team, newHeat, meshClaimCounts[_meshID], costBurned);
    }

    function attackMesh(string calldata _meshID)
        external
        nonReentrant
        whenNotPaused
    {
        require(isValidMeshID(_meshID), "Invalid meshID format");
        Team attackerTeam = _requireUserTeam(msg.sender);
        (int256 heat, Team defenderTeam) = _decodeHeat(meshHeats[_meshID]);
        require(heat != 0, "Mesh neutral");
        require(defenderTeam != Team.None && defenderTeam != attackerTeam, "Not enemy mesh");

        uint256 absHeat = _abs(heat);
        uint256 cost = _calculateAttackCost(absHeat);
        _spendPoints(msg.sender, cost);

        int256 newHeat = heat + (defenderTeam == Team.Blue ? int256(-1) : int256(1));
        bool neutralized = newHeat == 0;
        if (neutralized) {
            meshHeats[_meshID] = HEAT_OFFSET;
            meshClaimCounts[_meshID] = 0;
        } else {
            meshHeats[_meshID] = _encodeHeat(newHeat);
        }

        emit MeshAttacked(
            msg.sender,
            _meshID,
            attackerTeam,
            defenderTeam,
            absHeat,
            _abs(newHeat),
            cost,
            neutralized
        );
    }

    function captureMesh(string calldata _meshID)
        external
        nonReentrant
        whenNotPaused
    {
        require(isValidMeshID(_meshID), "Invalid meshID format");
        Team team = _requireUserTeam(msg.sender);
        (int256 heat, ) = _decodeHeat(meshHeats[_meshID]);
        require(heat == 0, "Mesh not neutral");
        require(meshEverClaimed[_meshID], "Unclaimed mesh");

        uint256 costBurned = _calculateCaptureCost();
        _burnClaimCost(msg.sender, _meshID, costBurned);

        int256 newHeat = team == Team.Blue ? int256(1) : int256(-1);
        meshHeats[_meshID] = _encodeHeat(newHeat);
        meshClaimCounts[_meshID] = team == Team.Blue ? int256(1) : int256(-1);

        emit MeshCaptured(msg.sender, _meshID, team, newHeat, meshClaimCounts[_meshID], costBurned);
    }

    // ============ 查询 ============
    function getMeshHeat(string calldata _meshID) external view returns (int256) {
        (int256 heat, ) = _decodeHeat(meshHeats[_meshID]);
        return heat;
    }

    function getMeshTeam(string calldata _meshID) external view returns (Team) {
        (, Team team) = _decodeHeat(meshHeats[_meshID]);
        return team;
    }

    function getMeshInfo(string calldata _meshID)
        external
        view
        returns (int256 claimCount, int256 heat, int32 lon100, int32 lat100)
    {
        claimCount = meshClaimCounts[_meshID];
        (heat, ) = _decodeHeat(meshHeats[_meshID]);
        (lon100, lat100) = _parseMeshId(_meshID);
    }

    function quoteCost(string calldata _meshID) external view returns (int256 heat, uint256 costBurned) {
        (heat, ) = _decodeHeat(meshHeats[_meshID]);
        if (heat == 0) {
            costBurned = 0;
        } else {
            costBurned = _calculateClaimCost(_abs(heat));
        }
    }

    // ============ 内部工具 ============
    function _ensureUserTeam(address user, Team team) internal {
        Team current = userTeams[user];
        if (current == Team.None) {
            userTeams[user] = team;
            emit TeamAssigned(user, team);
        } else {
            require(current == team, "Team mismatch");
        }
    }

    function _requireUserTeam(address user) internal view returns (Team) {
        Team team = userTeams[user];
        require(team != Team.None, "Team not set");
        return team;
    }

    function _spendPoints(address user, uint256 amount) internal {
        require(amount > 0, "Zero amount");
        require(pointsBalance[user] >= amount, "Insufficient points");
        pointsBalance[user] -= amount;
        emit PointsSpent(user, amount);
    }

    function _calculateClaimCost(uint256 absHeat) internal view returns (uint256) {
        if (absHeat == 0 || burnScaleMilli == 0) {
            return 0;
        }
        uint256 heatSq = absHeat * absHeat;
        uint256 baseCost = BASE_BURN_AMOUNT * heatSq;
        return (baseCost * burnScaleMilli) / 1000;
    }

    function _calculateCaptureCost() internal view returns (uint256) {
        if (burnScaleMilli == 0) {
            return 0;
        }
        return (BASE_BURN_AMOUNT * burnScaleMilli) / 1000;
    }

    function _calculateAttackCost(uint256 absHeat) internal view returns (uint256) {
        if (absHeat == 0) {
            return 0;
        }
        uint256 baseCost = attackBaseCost * absHeat;
        return (baseCost * attackMultiplierMilli) / 1000;
    }

    function _burnClaimCost(address user, string calldata meshID, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        require(meshToken.transferFrom(user, DEAD_ADDRESS, amount), "MESH transfer failed");
        totalBurn += amount;
        emit TokensBurned(amount, 1);
        emit ClaimCostBurned(user, meshID, amount);
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-value);
    }

    function _encodeHeat(int256 actualHeat) internal pure returns (uint256) {
        if (actualHeat == 0) {
            return HEAT_OFFSET;
        }
        if (actualHeat > 0) {
            return HEAT_OFFSET + uint256(actualHeat);
        }
        return HEAT_OFFSET - uint256(-actualHeat);
    }

    function _decodeHeat(uint256 storedHeat) internal pure returns (int256, Team) {
        if (storedHeat == 0 || storedHeat == HEAT_OFFSET) {
            return (0, Team.None);
        }
        if (storedHeat > HEAT_OFFSET) {
            return (int256(storedHeat - HEAT_OFFSET), Team.Blue);
        }
        return (-int256(HEAT_OFFSET - storedHeat), Team.Orange);
    }

    function isValidMeshID(string memory _meshID) public pure returns (bool) {
        bytes memory b = bytes(_meshID);
        if (b.length < 3 || b.length > 32) {
            return false;
        }
        if (!(b[0] == bytes1("E") || b[0] == bytes1("W"))) {
            return false;
        }
        uint256 i = 1;
        uint256 sep = type(uint256).max;
        for (; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == bytes1("N") || c == bytes1("S")) {
                sep = i;
                break;
            }
            if (c < bytes1("0") || c > bytes1("9")) {
                return false;
            }
        }
        if (sep == type(uint256).max) {
            return false;
        }
        if (sep == 1) {
            return false;
        }
        if (sep + 1 >= b.length) {
            return false;
        }
        for (uint256 j = sep + 1; j < b.length; j++) {
            bytes1 c2 = b[j];
            if (c2 < bytes1("0") || c2 > bytes1("9")) {
                return false;
            }
        }
        uint256 lonAbs = 0;
        for (uint256 k = 1; k < sep; k++) {
            lonAbs = lonAbs * 10 + (uint8(b[k]) - uint8(bytes1("0")));
            if (lonAbs >= 18000) {
                return false;
            }
        }
        uint256 latAbs = 0;
        for (uint256 m = sep + 1; m < b.length; m++) {
            latAbs = latAbs * 10 + (uint8(b[m]) - uint8(bytes1("0")));
            if (latAbs > 9000) {
                return false;
            }
        }
        return true;
    }

    function _parseMeshId(string memory _meshID) private pure returns (int32 lon100, int32 lat100) {
        bytes memory b = bytes(_meshID);
        if (b.length < 3) {
            return (0, 0);
        }
        int8 signLon = 1;
        if (b[0] == bytes1("W")) {
            signLon = -1;
        }
        uint256 i = 1;
        uint256 sep = type(uint256).max;
        for (; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == bytes1("N") || c == bytes1("S")) {
                sep = i;
                break;
            }
        }
        if (sep == type(uint256).max || sep == 1 || sep + 1 >= b.length) {
            return (0, 0);
        }
        uint256 lonAbs = 0;
        for (uint256 k = 1; k < sep; k++) {
            lonAbs = lonAbs * 10 + (uint8(b[k]) - uint8(bytes1("0")));
        }
        int8 signLat = 1;
        if (b[sep] == bytes1("S")) {
            signLat = -1;
        }
        uint256 latAbs = 0;
        for (uint256 m = sep + 1; m < b.length; m++) {
            latAbs = latAbs * 10 + (uint8(b[m]) - uint8(bytes1("0")));
        }
        if (lonAbs >= 18000 || latAbs > 9000) {
            return (0, 0);
        }
        lon100 = int32(int256(int(signLon) * int(lonAbs)));
        lat100 = int32(int256(int(signLat) * int(latAbs)));
    }
}
