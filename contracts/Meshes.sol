// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Meshes - 基于地理网格的ERC20代币系统
 * @dev 这是一个创新的代币系统，用户通过认领地理网格来获得代币奖励
 * 
 * 核心机制：
 * 1. 网格认领：用户认领地理网格（如E123N45），获得代币奖励
 * 2. 热度系统：网格被认领次数越多，热度越高，奖励越多
 * 3. 燃烧机制：重复认领需要燃烧代币，防止过度投机
 * 4. 时间衰减：代币供应量随时间衰减，模拟稀缺性
 * 5. 基金会分配：部分代币分配给基金会，支持生态发展
 * 
 * 安全特性：
 * - 重入保护：防止重入攻击
 * - 暂停机制：紧急情况下可暂停合约
 * - 访问控制：关键功能仅限治理地址调用
 * 
 * @author Parallels Team
 * @notice 本合约实现了基于地理网格的代币经济系统
 */
contract Meshes is ERC20, ReentrancyGuard, Pausable, Ownable {
    /**
     * @dev 用户认领信息结构体
     * @param user 认领用户地址
     * @param meshID 网格ID（如"E123N45"）
     * @param updateTs 最后更新时间戳
     * @param withdrawTs 最后提取时间戳
     */
    struct MintInfo {
        address user;        // 认领用户地址
        string meshID;       // 网格ID，格式为"E/W + 经度 + N/S + 纬度"
        uint256 updateTs;    // 最后更新时间戳
        uint256 withdrawTs;  // 最后提取时间戳
    }

    // ============ 时间相关常量 ============
    /** @dev 一天的秒数 */
    uint256 private constant SECONDS_IN_DAY = 86400;

    /** @dev 单次衰减处理允许的最大天数，避免一次性循环过大消耗 gas */
    uint256 private constant MAX_DECAY_DAYS_PER_CALL = 365;
    
    /** @dev 总铸造持续时间：10年，用于计算代币衰减 */
    uint256 private constant TOTAL_MINT_DURATION = 10 * 365 * SECONDS_IN_DAY; // 10年
    
    // ============ 测试模式时间常量 ============
    /** @dev 测试模式：首次提现冷却时间（10分钟） */
    uint256 private constant TEST_FIRST_WITHDRAW_COOLDOWN = 600; // 10分钟
    
    /** @dev 测试模式：年衰减周期（10分钟） */
    uint256 private constant TEST_YEAR_PERIOD_SECONDS = 600; // 10分钟
    
    // 已废弃的常量（保留用于历史记录）
    //    uint256 public constant MAX_TOTAL_SUPPLY = 81_000_000_000 * 10**18; // 81亿枚
    //    uint256 public constant MAX_MINT_PER_CALL = 100 * 10**18; // 每次铸造上限为100枚

    // ============ 燃烧机制参数 ============
    /** @dev 基础燃烧数量（wei单位），用于计算认领成本 */
    uint256 private constant BASE_BURN_AMOUNT = 10;

    // ============ 代币铸造参数 ============
    /** @dev 当前日铸造因子，用于计算每日可铸造的代币数量 */
    uint256 public dailyMintFactor;
    
    /** @dev 记录上次更新的"相对创世"的日期索引，用于优化计算 */
    uint256 public lastUpdatedDay = 0;

    /**
     * @dev 燃烧缩放比例（千分位精度），表示对基础成本的乘数
     * @notice 0 表示关闭燃烧；1000 表示 1.000x；1000000 表示 1000.000x
     * @notice 范围 [0, 1_000_000]，用于动态调整燃烧成本
     */
    uint256 public burnScaleMilli = 1000;

    // ============ 用户数据映射 ============
    /** @dev 用户认领信息映射：用户地址 => 网格ID => 认领信息 */
    mapping(address => mapping(string => MintInfo)) public userMints;
    
    /** @dev 网格认领计数：网格ID => 认领次数（避免数组膨胀） */
    mapping(string => uint32) public meshClaimCount;
    
    /** @dev 网格热度值：网格ID => 热度值（基于认领次数计算） */
    mapping(string => uint256) public meshHeats;
    
    /** @dev 用户累计权重：用户地址 => 累计权重（影响代币奖励） */
    mapping(address => uint256) public userWeightSum;
    
    /** @dev 用户认领次数：用户地址 => 认领次数 */
    mapping(address => uint32) public userClaimCounts;
    
    /** @dev 用户上次提现日：用户地址 => 上次提现的"相对创世"的天索引 */
    mapping(address => uint256) public lastWithdrawDay;
    
    /** @dev 铸币者权限：用户地址 => 是否有铸币权限 */
    mapping(address => bool) private minters;
    
    // spendNonce 已弃用（旧多签相关）

    // legacy owner fields removed; governance via Gnosis Safe

    // ============ 系统状态变量 ============
    /** @dev 创世时间戳，用于计算相对时间 */
    uint256 public genesisTs;
    
    /** @dev 活跃认领者数量 */
    uint256 public activeClaimers;
    
    /** @dev 活跃网格数量（被认领的网格数） */
    uint256 public activeMeshes;
    
    /** @dev 总认领次数 */
    uint256 public totalClaimMints;
    
    /** @dev 最大网格热度值（用于计算燃烧成本） */
    uint256 public maxMeshHeats;
    
    /** @dev 总燃烧代币数量 */
    uint256 public totalBurn;

    // ============ 地址配置 ============
    /** @dev MeshesTreasury 地址，接收部分代币分配 */
    address public treasuryAddress;
    
    /** @dev 治理安全地址（Gnosis Safe），用于管理合约 */
    address public governanceSafeAddress;
    
    // ============ 治理模式切换 ============
    /** @dev 治理模式：true=Safe治理，false=Owner治理 */
    bool public isSafeGovernance = false;
    
    /** @dev 治理模式切换锁定：一旦切换到Safe模式，无法回退到Owner模式 */
    bool public governanceLocked = false;

    // ============ Treasury 分配机制 ============
    /** @dev Treasury 待转池，累积待转给 Treasury 的代币 */
    uint256 public pendingTreasuryPool;
    
    /** @dev 上次 Treasury 转账的小时索引 */
    uint256 public lastPayoutHour;
    
    /** @dev 小时秒数常量 */
    uint256 private constant HOUR_SECONDS = 3600;

    // ============ 用户余额与处理进度 ============
    /** @dev 用户未提现余额（用于"日衰减 50%"记账） */
    mapping(address => uint256) public carryBalance;
    
    /** @dev 用户已处理至的日索引（含），用于优化日衰减计算 */
    mapping(address => uint256) public lastProcessedDay;
    
    /** @dev 新用户第一次claim的时间戳，用于24小时提取限制 */
    mapping(address => uint256) public firstClaimTimestamp;
    /** @dev 用户是否已完成首次提现（用于区分首提24小时规则与旧用户日限制） */
    mapping(address => bool) public hasWithdrawn;

    // ============ 历史记录映射 ============
    /** @dev 每日铸造数量记录：日索引 => 铸造数量 */
    mapping(uint256 => uint256) public dayMintAmount;
    
    /** @dev 用户总铸造数量：用户地址 => 总铸造数量 */
    mapping(address => uint256) public userTotalMint;

    // ============ 事件定义 ============
    // 已废弃的事件（保留用于历史记录）
    //event ClaimMint(address indexed user, string indexed meshID, uint256 indexed time);
    
    /** @dev 网格热度更新事件：当网格被认领时触发 */
    event DegreeHeats(string indexed meshID, uint256 heat, uint256 len);
    
    /** @dev 用户代币铸造事件：当用户获得代币奖励时触发 */
    event UserMint(address indexed user, uint256 amount);
    
    /** @dev 用户提取事件：当用户提取代币时触发 */
    event UserWithdraw(address indexed user, uint256 amount);
    
    /** @dev 燃烧缩放比例更新事件：当燃烧成本调整时触发 */
    event BurnScaleUpdated(uint256 indexed oldMilli, uint256 indexed newMilli);
    
    /** @dev MeshesTreasury 地址更新事件：当 Treasury 地址变更时触发 */
    event TreasuryAddressUpdated(address indexed oldAddress, address indexed newAddress);
    
    /** @dev Treasury 费用累积事件：当 Treasury 费用累积时触发 */
    event TreasuryFeeAccrued(uint256 indexed amount, uint256 indexed time);
    
    /** @dev Treasury 转账事件：当 Treasury 收到代币时触发 */
    event TreasuryPayout(uint256 indexed amount, uint256 indexed time);
    
    // ============ 开发者友好事件 ============
    /** @dev 网格认领事件：包含详细的认领信息，便于前端展示 */
    event MeshClaimed(
        address indexed user,      // 认领用户
        string indexed meshID,     // 网格ID
        int32 lon100,             // 经度（以0.01度为单位）
        int32 lat100,             // 纬度（以0.01度为单位）
        uint32 applyCount,        // 申请次数
        uint256 heat,             // 热度值
        uint256 costBurned        // 燃烧成本
    );
    
    /** @dev 用户权重更新事件：当用户权重变化时触发 */
    event UserWeightUpdated(address indexed user, uint256 newWeight, uint32 claimCount);
    
    /** @dev 提取处理事件：包含详细的提取信息，便于分析 */
    event WithdrawProcessed(
        address indexed user,      // 提取用户
        uint256 payout,           // 提取数量
        uint256 burned,           // 燃烧数量
        uint256 treasury,         // Treasury 分配
        uint256 carryAfter,       // 提取后结转余额
        uint256 dayIndex          // 日索引
    );
    /** @dev 代币燃烧事件：当代币被燃烧时触发 */
    event TokensBurned(uint256 amount, uint8 reasonCode); // 1=claim_cost, 2=unclaimed_decay
    
    /** @dev 认领成本燃烧事件：当用户认领网格燃烧代币时触发 */
    event ClaimCostBurned(address indexed user, string indexed meshID, uint256 amount);
    
    /** @dev 年因子更新事件：当年衰减因子更新时触发 */
    event YearFactorUpdated(uint256 indexed yearIndex, uint256 factor1e10);
    
    /** @dev 未认领衰减应用事件：当应用日衰减时触发 */
    event UnclaimedDecayApplied(
        address indexed user,      // 用户地址
        uint256 daysProcessed,     // 处理的天数
        uint256 burned,           // 燃烧数量
        uint256 treasury,         // Treasury 分配
        uint256 carryAfter        // 处理后的结转余额
    );
    
    /** @dev 治理安全地址更新事件：当治理地址变更时触发 */
    event GovernanceSafeUpdated(address indexed oldSafe, address indexed newSafe);
    
    /** @dev 治理模式切换事件：当治理模式变更时触发 */
    event GovernanceModeSwitched(bool indexed isSafeGovernance, address indexed caller, uint256 timestamp);
    
    /** @dev 治理模式锁定事件：当治理模式被锁定时触发 */
    event GovernanceModeLocked(bool indexed isSafeGovernance, address indexed caller, uint256 timestamp);

    // ============ 访问控制修饰符 ============
    /** @dev 仅限治理安全地址调用的修饰符 */
    modifier onlySafe() {
        require(msg.sender == governanceSafeAddress, "Only Safe");
        _;
    }
    
    /** @dev 仅限当前治理者调用的修饰符（Owner或Safe） */
    modifier onlyGovernance() {
        if (isSafeGovernance) {
            require(msg.sender == governanceSafeAddress, "Only Safe governance");
        } else {
            require(msg.sender == owner(), "Only Owner governance");
        }
        _;
    }
    
    /** @dev 仅限Owner调用的修饰符（无论治理模式） */
    modifier onlyContractOwner() {
        require(msg.sender == owner(), "Only Owner");
        _;
    }

    // ============ 预计算常量 ============
    /** @dev 预计算的 (1.2 ** n) 值，当 n < 30 时使用，用于优化计算 */
    uint256[] private precomputedDegreeHeats = [
        1 ether,
        1.2 ether,
        1.44 ether,
        1.728 ether,
        2.0736 ether,
        2.48832 ether,
        2.985984 ether,
        3.5831808 ether,
        4.29981696 ether,
        5.159780352 ether,
        6.1917364224 ether,
        7.43008370688 ether,
        8.916100448256 ether,
        10.6993205379072 ether,
        12.83918464548864 ether,
        15.407021574586368 ether,
        18.48842588950364 ether,
        22.186111067404368 ether,
        26.623333280885244 ether,
        31.947999937062296 ether,
        38.33759992447475 ether,
        46.0051199093697 ether,
        55.20614389124364 ether,
        66.24737266949237 ether,
        79.49684720339084 ether,
        95.39621664406896 ether,
        114.47545997288273 ether,
        137.3705519674593 ether,
        164.84466236095116 ether,
        197.81359483314138 ether
    ];

    /**
     * @dev 构造函数，初始化Mesh代币合约
     * @param _governanceSafeAddress 治理安全地址，用于管理合约
     * 
     * 初始化过程：
     * 1. 设置代币名称和符号
     * 2. 记录创世时间戳
     * 3. 配置治理地址
     * 4. 初始化日铸造因子
     * 5. 设置 Treasury 转账时间
     * 6. treasuryAddress 初始化为 address(0)，后续通过 setTreasuryAddress 设置
     */
    constructor(
        address _governanceSafeAddress
    ) ERC20("Mesh Token", "MESH") {
        require(_governanceSafeAddress != address(0), "Invalid safe address");

        // 记录创世时间戳，用于计算相对时间
        genesisTs = block.timestamp;
        
        // 设置治理地址
        governanceSafeAddress = _governanceSafeAddress;
        // treasuryAddress 初始化为 address(0)，后续通过 setTreasuryAddress 设置
        treasuryAddress = address(0);
        
        // 初始化日因子为首日值（1e10 = 1.0，表示100%）
        dailyMintFactor = 1e10;
        lastUpdatedDay = 0;
        
        // 设置 Treasury 转账时间（按小时计算）
        lastPayoutHour = block.timestamp / HOUR_SECONDS;
    }

    // ============ 私有辅助函数 ============
    /**
     * @dev 计算"自创世以来"的天索引
     * @return 当前时间相对于创世时间的天数索引
     * @notice 用于计算日衰减因子和用户处理进度
     */
    function _currentDayIndex() private view returns (uint256) {
        return (block.timestamp - genesisTs) / SECONDS_IN_DAY;
    }

    /**
     * @dev 计算当前时间的日铸造因子（测试模式：基于10分钟周期）
     * @return 当前的铸造因子（1e10 = 100%）
     * 
     * 算法说明：
     * - 基础因子：F0 = 1e10 (100%)
     * - 年衰减：每10分钟（测试模式）衰减10%，即乘以0.9
     * - 公式：Fd = F0 * (0.9 ^ yearPeriodIndex)
     * - 使用整数运算避免浮点数精度问题
     * @notice 测试模式下，dayIndex 参数不再使用，直接基于当前时间计算
     */
    function _dailyMintFactorForDay(uint256 /* dayIndex - 测试模式下未使用 */) private view returns (uint256) {
        // 测试模式：基于10分钟周期计算衰减
        // 计算从创世时间开始的10分钟周期索引
        uint256 currentTime = block.timestamp;
        uint256 yearPeriodIndex = (currentTime - genesisTs) / TEST_YEAR_PERIOD_SECONDS;
        
        // 快速幂（定点 1e10，不缩放底数，仅整数比例）
        // 预计算 0.9^n 的 1e10 定点：每周期乘以 0.9（用 9/10 近似）
        uint256 factor = 1e10;
        for (uint256 i = 0; i < yearPeriodIndex; i++) {
            factor = (factor * 9) / 10; // 每10分钟周期衰减 10%
            if (factor == 0) break; // 防止下溢
        }
        return factor;
    }

    /**
     * @dev 计算日铸造因子的等差数列和
     * @param a 起始日索引（包含）
     * @param b 结束日索引（包含）
     * @return 该区间内所有日铸造因子的和
     * 
     * 算法说明：
     * - 使用等差数列求和公式：S = (first + last) * n / 2
     * - 其中 first 和 last 分别是起始和结束日的铸造因子
     * - n 是区间内的天数
     * - 使用整数运算避免精度损失
     */
    function _sumDailyMintFactor(uint256 a, uint256 b) private view returns (uint256) {
        if (b < a) return 0; // 无效区间
        uint256 n = b - a + 1; // 区间内的天数
        uint256 first = _dailyMintFactorForDay(a); // 起始日因子
        uint256 last = _dailyMintFactorForDay(b);  // 结束日因子
        
        // 等差数列求和：(first + last) * n / 2，按整数下取
        return ((first + last) * n) / 2;
    }

    /**
     * @dev 设置燃烧缩放比例（仅限治理地址）
     * @param _milli 缩放比例（千分位精度），范围 [0, 1_000_000]
     * 
     * 功能说明：
     * - 0：关闭燃烧机制
     * - 1000：1.000x（正常燃烧）
     * - 1000000：1000.000x（高燃烧成本）
     * 
     * 使用场景：
     * - 调整认领成本，控制网格认领频率
     * - 在代币价格波动时调整燃烧成本
     * - 根据网络活跃度动态调整参数
     * 
     * 安全特性：
     * - 仅限治理地址调用
     * - 暂停时不可调用
     * - 范围检查防止异常值
     */
    function setBurnScale(uint256 _milli) external onlyGovernance whenNotPaused {
        require(_milli <= 1_000_000, "Scale too large");
        uint256 old = burnScaleMilli;
        burnScaleMilli = _milli;
        emit BurnScaleUpdated(old, _milli);
    }

    /**
     * @dev 更新 MeshesTreasury 地址（仅限治理地址）
     * @param _newTreasuryAddr 新的 MeshesTreasury 地址
     * 
     * 功能说明：
     * - 更新接收代币分配的 MeshesTreasury 地址
     * - Treasury 地址用于接收系统分配的部分代币
     * - 支持生态发展和项目运营
     * 
     * 安全特性：
     * - 仅限治理地址调用
     * - 暂停时不可调用
     * - 地址验证：不能为零地址
     * - 重复检查：不能设置为相同地址
     * - 首次设置：从 address(0) 设置时跳过白名单检查
     * - Owner治理模式：Owner可以多次修改
     * - Safe治理模式：治理可以自由迁移地址
     * - 事件记录：便于追踪地址变更
     */
    function setTreasuryAddress(
        address _newTreasuryAddr
    ) external onlyGovernance whenNotPaused {
        require(_newTreasuryAddr != address(0), "Invalid treasury address");
        require(_newTreasuryAddr != treasuryAddress, "Same treasury address");
        
        address oldTreasury = treasuryAddress;
        
        // 如果是首次设置（从 address(0) 设置），跳过白名单检查
        if (treasuryAddress == address(0)) {
            treasuryAddress = _newTreasuryAddr;
            emit TreasuryAddressUpdated(oldTreasury, _newTreasuryAddr);
            return;
        }
        
        // 如果当前是Owner治理模式，允许Owner多次修改，无需白名单检查
        if (!isSafeGovernance) {
            treasuryAddress = _newTreasuryAddr;
            emit TreasuryAddressUpdated(oldTreasury, _newTreasuryAddr);
            return;
        }
        
        // Safe治理模式下，不再依赖旧 Treasury 的白名单回调，确保治理可自由迁移地址
        treasuryAddress = _newTreasuryAddr;
        emit TreasuryAddressUpdated(oldTreasury, _newTreasuryAddr);
    }

    /**
     * @dev 紧急暂停合约（仅限当前治理者）
     */
    function pause() external onlyGovernance {
        _pause();
    }

    /**
     * @dev 恢复合约（仅限当前治理者）
     */
    function unpause() external onlyGovernance {
        _unpause();
    }

    function setGovernanceSafe(address _newSafe) external onlyGovernance whenNotPaused {
        require(_newSafe != address(0), "Invalid safe");
        require(_newSafe != governanceSafeAddress, "Same safe");
        address old = governanceSafeAddress;
        governanceSafeAddress = _newSafe;
        emit GovernanceSafeUpdated(old, _newSafe);
    }
    
    /**
     * @dev 切换到Safe治理模式（仅限Owner，且只能切换一次）
     * 
     * 功能说明：
     * - 将治理权限从Owner切换到Safe
     * - 一旦切换，无法回退到Owner模式
     * - 确保治理的去中心化和安全性
     * 
     * 安全特性：
     * - 仅限Owner调用
     * - 只能切换一次，防止重复切换
     * - 暂停时不可调用
     * - 事件记录：便于追踪治理模式变更
     */
    function switchToSafeGovernance() external onlyContractOwner whenNotPaused {
        require(!governanceLocked, "Governance already locked");
        require(governanceSafeAddress != address(0), "Safe address not set");
        require(!isSafeGovernance, "Already in Safe governance");
        
        isSafeGovernance = true;
        governanceLocked = true;
        
        emit GovernanceModeSwitched(true, msg.sender, block.timestamp);
        emit GovernanceModeLocked(true, msg.sender, block.timestamp);
    }
    
    /**
     * @dev 获取当前治理信息
     * @return _isSafeGovernance 是否为Safe治理模式
     * @return _governanceLocked 治理模式是否已锁定
     * @return _currentGovernance 当前治理者地址
     */
    function getGovernanceInfo() external view returns (
        bool _isSafeGovernance,
        bool _governanceLocked,
        address _currentGovernance
    ) {
        _isSafeGovernance = isSafeGovernance;
        _governanceLocked = governanceLocked;
        _currentGovernance = isSafeGovernance ? governanceSafeAddress : owner();
    }

    /**
     * @dev 验证网格ID格式
     */
    function isValidMeshID(string memory _meshID) public pure returns (bool) {
        bytes memory b = bytes(_meshID);
        if (b.length < 3 || b.length > 32) {
            return false;
        }
        // 规则：^[EW][0-9]+[NS][0-9]+$
        if (!(b[0] == bytes1("E") || b[0] == bytes1("W"))) {
            return false;
        }
        uint256 i = 1;
        uint256 sep = type(uint256).max; // 记录 N/S 的位置
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
            return false; // 未找到 N/S 分隔符
        }
        if (sep == 1) {
            return false; // 经度数字缺失
        }
        if (sep + 1 >= b.length) {
            return false; // 纬度数字缺失
        }
        // 校验纬度部分均为数字
        for (uint256 j = sep + 1; j < b.length; j++) {
            bytes1 c2 = b[j];
            if (c2 < bytes1("0") || c2 > bytes1("9")) {
                return false;
            }
        }
        // 解析数值并检查范围：|lon*100| < 18000, |lat*100| <= 9000
        uint256 lonAbs = 0;
        for (uint256 k = 1; k < sep; k++) {
            lonAbs = lonAbs * 10 + (uint8(b[k]) - uint8(bytes1("0")));
            if (lonAbs >= 18000) {
                // 经度上限为 17999（对应 [-180,180) 的 0.01 度网格）
                return false;
            }
        }
        uint256 latAbs = 0;
        for (uint256 m = sep + 1; m < b.length; m++) {
            latAbs = latAbs * 10 + (uint8(b[m]) - uint8(bytes1("0")));
            if (latAbs > 9000) {
                // 纬度上限为 9000（对应 [-90,90] 的 0.01 度网格）
                return false;
            }
        }
        return true;
    }

    /**
     * @dev 认领网格铸造权 - 核心功能函数
     * @param _meshID 网格ID，格式为"E/W + 经度 + N/S + 纬度"（如"E123N45"）
     * 
     * 功能说明：
     * 1. 验证网格ID格式和用户资格
     * 2. 计算并扣除认领成本（如果网格已被认领过）
     * 3. 更新网格热度和用户权重
     * 4. 记录认领信息
     * 5. 触发相关事件
     * 
     * 燃烧机制：
     * - 首次认领：免费
     * - 重复认领：需要燃烧代币，成本 = BASE_BURN_AMOUNT * (heat^2) / maxMeshHeats * burnScaleMilli / 1000
     * - 燃烧的代币会被永久销毁，减少总供应量
     * 
     * 安全特性：
     * - 重入保护：防止重入攻击
     * - 暂停机制：紧急情况下可暂停
     * - 输入验证：确保网格ID格式正确
     * - 重复检查：防止同一用户重复认领同一网格
     */
    function claimMesh(string memory _meshID) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        _claimMeshInternal(msg.sender, _meshID);
    }

    function claimMeshFor(address _user, string memory _meshID)
        external
        onlyGovernance
        nonReentrant
        whenNotPaused
    {
        _claimMeshInternal(_user, _meshID);
    }

    function _claimMeshInternal(address _user, string memory _meshID) private {
        require(_user != address(0), "Invalid user address");
        require(bytes(_meshID).length > 0, "MeshID cannot be empty");
        require(isValidMeshID(_meshID), "Invalid meshID format");

        MintInfo memory mintInfo = userMints[_user][_meshID];
        require(mintInfo.updateTs == 0, "Already claim");

        uint256 _len = meshClaimCount[_meshID];
        if (_len == 0) {
            activeMeshes++;
        }

        uint256 costBurned = 0;
        if (burnScaleMilli > 0 && _len > 0) {
            uint256 denom = maxMeshHeats == 0 ? 1 : maxMeshHeats;
            uint256 heatForCost = meshHeats[_meshID];
            if (heatForCost == 0) {
                heatForCost = calculateDegreeHeat(_len);
            }
            uint256 scaledHeatSq = (heatForCost * heatForCost) / 1 ether;
            uint256 _amount = (BASE_BURN_AMOUNT * scaledHeatSq) / denom;
            _amount = (_amount * burnScaleMilli) / 1000;
            require(balanceOf(_user) >= _amount, "Insufficient to burn");

            totalBurn += _amount;
            _burn(_user, _amount);
            costBurned = _amount;
            emit TokensBurned(_amount, 1);
            emit ClaimCostBurned(_user, _meshID, _amount);
        }

        uint256 cd = _currentDayIndex();
        if (cd > 0) {
            _applyUnclaimedDecay(_user, cd, false);
        }

        mintInfo.meshID = _meshID;
        mintInfo.user = _user;
        mintInfo.updateTs = block.timestamp;
        mintInfo.withdrawTs = block.timestamp;
        userMints[_user][_meshID] = mintInfo;

        uint256 _degreeHeat = calculateDegreeHeat(_len);
        meshHeats[_meshID] = _degreeHeat;
        if (_degreeHeat > maxMeshHeats) {
            maxMeshHeats = _degreeHeat;
        }

        emit DegreeHeats(_meshID, _degreeHeat, _len);

        userClaimCounts[_user] += 1;
        userWeightSum[_user] += _degreeHeat;
        emit UserWeightUpdated(_user, userWeightSum[_user], userClaimCounts[_user]);

        if (userClaimCounts[_user] == 1) {
            firstClaimTimestamp[_user] = block.timestamp;
            lastProcessedDay[_user] = _currentDayIndex();
        }

        meshClaimCount[_meshID] = uint32(_len + 1);

        (int32 lon100, int32 lat100) = _parseMeshId(_meshID);
        emit MeshClaimed(
            _user,
            _meshID,
            lon100,
            lat100,
            uint32(_len + 1),
            _degreeHeat,
            costBurned
        );

        if (!minters[_user]) {
            activeClaimers++;
            minters[_user] = true;
        }

        totalClaimMints++;
        _maybePayoutTreasury();
    }

    function calculateDegreeHeat(uint256 _n) internal view returns (uint256) {
        if (_n < 30) {
            return precomputedDegreeHeats[_n];
        } else {
            // 防止线性循环 DoS：使用闭式近似（截断到 n=60 上限）
            if (_n > 60) {
                _n = 60;
            }
            uint256 base = 1.2 ether;
            uint256 result = precomputedDegreeHeats[29];
            for (uint256 i = 30; i <= _n; i++) {
                result = (result * base) / 1 ether;
            }
            return result;
        }
    }

    /**
     * @dev 铸造代币（内部函数）
     */
    function mint(address user, uint256 amount) private {
        uint256 _today = _currentDayIndex();
        dayMintAmount[_today] += amount;
        _mint(user, amount);
    }

    /**
     * @dev 提取收益 - 用户提取代币奖励的核心函数
     * 
     * 功能说明：
     * 1. 验证用户是否有认领记录
     * 2. 检查提取时间限制（新用户24小时限制，旧用户日限制）
     * 3. 应用未认领代币的日衰减（50%）
     * 4. 计算并发放今日应得代币
     * 5. 更新用户状态和下次提取时间
     * 6. 触发基金会转账（如果满足条件）
     * 
     * 时间限制机制：
     * - 新用户：第一次claim后24小时内可提取，提取后设置下次提取时间为24小时后
     * - 旧用户：使用原有的日限制机制（每天只能提取一次）
     * 
     * 代币计算：
     * - 今日应得 = dailyMintFactor * userWeightSum / 1e10
     * - 总发放 = 结转余额 + 今日应得
     * - 结转余额会在日衰减中减少
     * 
     * 安全特性：
     * - 重入保护：防止重入攻击
     * - 暂停机制：紧急情况下可暂停
     * - 时间限制：防止频繁提取
     * - 余额检查：确保有足够的代币可提取
     * - 若积压天数超过 MAX_DECAY_DAYS_PER_CALL，需要先调用 processUnclaimedDecay 分批推进
     */
    function withdraw() public nonReentrant whenNotPaused {
        uint256 dayIndex = _currentDayIndex();
        require(userClaimCounts[msg.sender] > 0, "No claims");
        
        // 首次提现需满足：距首次认领已满10分钟（测试模式）；之后按"每天一次"限制
        if (!hasWithdrawn[msg.sender]) {
            uint256 firstClaimTime = firstClaimTimestamp[msg.sender];
            require(firstClaimTime > 0 && block.timestamp >= firstClaimTime + TEST_FIRST_WITHDRAW_COOLDOWN, "First claim cooldown");
        } else {
            require(dayIndex > lastWithdrawDay[msg.sender], "Daily receive");
        }

        // 更新今日 dailyMintFactor（与创世对齐）
        if (dayIndex != lastUpdatedDay) {
            dailyMintFactor = _dailyMintFactorForDay(dayIndex);
            lastUpdatedDay = dayIndex;
        }

        address user = msg.sender;
        uint256 weight = userWeightSum[user];
        require(weight > 0, "Zero weight");

        // 先对未领余额做“日衰减 50%”的懒结算（逐日推进到昨天）
        _applyUnclaimedDecay(user, dayIndex, false);

        // 处理今日领取：今日应得 + 结转余额一次性发放
        uint256 todayAmount = (dailyMintFactor * weight) / 1e10;
        uint256 payout = carryBalance[user] + todayAmount;
        require(payout > 0, "Zero mint");

        // 发放并清零结转
        mint(user, payout);
        carryBalance[user] = 0;
        lastProcessedDay[user] = dayIndex;
        
        // 标记已完成首次提现，并记录本日已提现（用于日限制）
        if (!hasWithdrawn[user]) {
            hasWithdrawn[user] = true;
        }
        lastWithdrawDay[user] = dayIndex;

        emit UserMint(user, payout);
        userTotalMint[user] += payout;

        emit WithdrawProcessed(user, payout, 0, 0, carryBalance[user], dayIndex);

        _maybePayoutTreasury();
    }

    /**
     * @dev 检查用户是否可以提取
     * @param user 用户地址
     * @return canWithdraw 是否可以提取
     * @return nextWithdrawTime 下次可提取时间（0表示使用日限制）
     */
    function canUserWithdraw(address user) public view returns (bool canWithdraw, uint256 nextWithdrawTime) {
        if (userClaimCounts[user] == 0) {
            return (false, 0);
        }
        
        if (!hasWithdrawn[user]) {
            uint256 firstClaimTime = firstClaimTimestamp[user];
            if (firstClaimTime == 0) {
                return (false, 0);
            }
            uint256 timeLimit = firstClaimTime + TEST_FIRST_WITHDRAW_COOLDOWN;
            canWithdraw = block.timestamp >= timeLimit;
            nextWithdrawTime = timeLimit;
            return (canWithdraw, nextWithdrawTime);
        }
        
        uint256 dayIndex = _currentDayIndex();
        canWithdraw = dayIndex > lastWithdrawDay[user];
        nextWithdrawTime = 0;
        return (canWithdraw, nextWithdrawTime);
    }

    function _maybePayoutTreasury() private {
        uint256 currentHour = block.timestamp / HOUR_SECONDS;
        if (currentHour > lastPayoutHour && pendingTreasuryPool > 0) {
            uint256 amount = pendingTreasuryPool;
            pendingTreasuryPool = 0;
            lastPayoutHour = currentHour;
            _transfer(address(this), treasuryAddress, amount);
            emit TreasuryPayout(amount, block.timestamp);
        }
    }

    // 任何人可发起的 Treasury 出账触发器（无外部程序依赖，gas 由调用者承担）
    function payoutTreasuryIfDue() external nonReentrant whenNotPaused {
        _maybePayoutTreasury();
    }

    /**
     * @dev 外部衰减推进入口，允许按批次处理超出上限的历史天数
     * @param user 需要处理的用户地址
     * @param upToDay 目标日索引（相对创世）；传 0 或超过当前天将自动取当前天
     * @return fullyProcessed 是否已经处理到指定 upToDay
     * @return processedDays 本次处理的天数
     */
    function processUnclaimedDecay(address user, uint256 upToDay)
        external
        nonReentrant
        whenNotPaused
        returns (bool fullyProcessed, uint256 processedDays)
    {
        require(user != address(0), "Invalid user");
        require(userClaimCounts[user] > 0, "No claims");

        uint256 currentDay = _currentDayIndex();
        if (upToDay == 0 || upToDay > currentDay) {
            upToDay = currentDay;
        }

        uint256 previous = lastProcessedDay[user];
        require(upToDay > previous, "No pending decay");

        fullyProcessed = _applyUnclaimedDecay(user, upToDay, true);
        processedDays = lastProcessedDay[user] > previous ? (lastProcessedDay[user] - previous) : 0;
    }

    // 按天精确推进未领余额的"日衰减 50%"直至 upToDay-1
    function _applyUnclaimedDecay(address user, uint256 upToDay, bool allowPartial) private returns (bool fullyProcessed) {
        uint256 fromDay = lastProcessedDay[user];
        if (fromDay >= upToDay) {
            return true;
        }

        uint256 targetDay = upToDay;
        uint256 daysToProcess = upToDay - fromDay;
        if (daysToProcess > MAX_DECAY_DAYS_PER_CALL) {
            require(allowPartial, "Decay range exceeds limit");
            targetDay = fromDay + MAX_DECAY_DAYS_PER_CALL;
            daysToProcess = MAX_DECAY_DAYS_PER_CALL;
            fullyProcessed = false;
        } else {
            fullyProcessed = true;
        }

        uint256 weight = userWeightSum[user];
        if (weight == 0) {
            lastProcessedDay[user] = targetDay - 1;
            return fullyProcessed;
        }

        uint256 burnedTotal = 0;
        uint256 treasuryTotal = 0;
        uint256 carry = carryBalance[user];
        for (uint256 d = fromDay; d < targetDay; d++) {
            uint256 factorD = _dailyMintFactorForDay(d);
            uint256 Rd = (factorD * weight) / 1e10;
            uint256 Xd = carry + Rd;
            if (Xd > 0) {
                uint256 burnD = (Xd * 40) / 100;
                uint256 treasuryD = (Xd * 10) / 100;
                carry = Xd - burnD - treasuryD; // 50% 结转
                burnedTotal += burnD;
                treasuryTotal += treasuryD;
            }
        }

        if (burnedTotal > 0) {
            mint(address(this), burnedTotal);
            _burn(address(this), burnedTotal);
            totalBurn += burnedTotal;
            emit TokensBurned(burnedTotal, 2);
        }
        if (treasuryTotal > 0) {
            mint(address(this), treasuryTotal);
            pendingTreasuryPool += treasuryTotal;
            emit TreasuryFeeAccrued(treasuryTotal, block.timestamp);
        }

        carryBalance[user] = carry;
        lastProcessedDay[user] = targetDay - 1;
        emit UnclaimedDecayApplied(user, daysToProcess, burnedTotal, treasuryTotal, carry);

        return fullyProcessed;
    }

    function getMeshInfo(string calldata _meshID) external view returns (
        uint32 applyCount,
        uint256 heat,
        int32 lon100,
        int32 lat100
    ) {
        applyCount = meshClaimCount[_meshID];
        heat = meshHeats[_meshID];
        (lon100, lat100) = _parseMeshId(_meshID);
    }

    function quoteClaimCost(string calldata _meshID) external view returns (uint256 heat, uint256 costBurned) {
        uint32 cnt = meshClaimCount[_meshID];
        heat = calculateDegreeHeat(cnt);
        uint256 denom = maxMeshHeats == 0 ? 1 : maxMeshHeats;
        if (cnt == 0 || burnScaleMilli == 0) {
            costBurned = 0;
        } else {
            uint256 scaledHeatSq = (heat * heat) / 1 ether;
            uint256 baseCost = (BASE_BURN_AMOUNT * scaledHeatSq) / denom;
            costBurned = (baseCost * burnScaleMilli) / 1000;
        }
    }

    function getUserState(address _user) external view returns (
        uint256 weight,
        uint32 claimCount,
        uint256 carryBalance_,
        uint256 lastProcessedDay_
    ) {
        weight = userWeightSum[_user];
        claimCount = userClaimCounts[_user];
        carryBalance_ = carryBalance[_user];
        lastProcessedDay_ = lastProcessedDay[_user];
    }

    function previewWithdraw(address _user) external view returns (
        uint256 payoutToday,
        uint256 carryBefore,
        uint256 carryAfterIfNoWithdraw,
        uint256 burnTodayIfNoWithdraw,
        uint256 treasuryTodayIfNoWithdraw,
        uint256 dayIndex
    ) {
        dayIndex = _currentDayIndex();
        uint256 weight = userWeightSum[_user];
        uint256 factor = _dailyMintFactorForDay(dayIndex);
        payoutToday = (factor * weight) / 1e10;
        carryBefore = carryBalance[_user];
        // 严格按天的"若不提现"模拟：仅计算今天一次
        uint256 Xd = carryBefore + payoutToday;
        burnTodayIfNoWithdraw = (Xd * 40) / 100;
        treasuryTodayIfNoWithdraw = (Xd * 10) / 100;
        carryAfterIfNoWithdraw = Xd - burnTodayIfNoWithdraw - treasuryTodayIfNoWithdraw;
    }

    // ===================== Internal utils =====================
    function _parseMeshId(string memory _meshID) private pure returns (int32 lon100, int32 lat100) {
        bytes memory b = bytes(_meshID);
        if (b.length < 3) {
            return (0, 0);
        }
        int8 signLon = 1;
        if (b[0] == bytes1("W")) signLon = -1;
        uint256 i = 1;
        uint256 sep = type(uint256).max;
        for (; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == bytes1("N") || c == bytes1("S")) { sep = i; break; }
        }
        if (sep == type(uint256).max || sep == 1 || sep + 1 >= b.length) {
            return (0, 0);
        }
        uint256 lonAbs = 0;
        for (uint256 k = 1; k < sep; k++) { lonAbs = lonAbs * 10 + (uint8(b[k]) - uint8(bytes1("0"))); }
        int8 signLat = 1;
        if (b[sep] == bytes1("S")) signLat = -1;
        uint256 latAbs = 0;
        for (uint256 m = sep + 1; m < b.length; m++) { latAbs = latAbs * 10 + (uint8(b[m]) - uint8(bytes1("0"))); }
        if (lonAbs >= 18000 || latAbs > 9000) {
            return (0, 0);
        }
        lon100 = int32(int256(int(signLon) * int(lonAbs)));
        lat100 = int32(int256(int(signLat) * int(latAbs)));
    }

    /**
     * @dev 获取网格数据统计
     */
    function getMeshData()
        external
        view
        returns (
            uint256 userCounts,
            uint256 launchData,
            uint256 totalMinted,
            uint256 liquidSupply
        )
    {
        userCounts = activeClaimers;
        launchData = (block.timestamp - genesisTs) / SECONDS_IN_DAY;
        totalMinted = totalSupply();
        liquidSupply = totalMinted - balanceOf(address(this));
    }

    /**
     * @dev 获取网格仪表板数据
     */
    function getMeshDashboard()
        external
        view
        returns (
            uint256 participants,
            uint256 totalclaimMints,
            uint256 claimedMesh,
            uint256 maxHeats,
            uint256 sinceGenesis
        )
    {
        participants = activeClaimers;
        totalclaimMints = totalClaimMints;
        claimedMesh = activeMeshes;
        maxHeats = maxMeshHeats;
        sinceGenesis = (block.timestamp - genesisTs) / SECONDS_IN_DAY;
    }

    /**
     * @dev 获取仪表板数据
     */
    function getDashboard()
        external
        view
        returns (
            uint256 _totalSupply,
            uint256 _liquidSupply,
            uint256 _destruction,
            uint256 _pending,
            uint256 _treasury
        )
    {
        _totalSupply = totalSupply();
        _liquidSupply = _totalSupply - balanceOf(address(this));
        _destruction = totalBurn;
        _pending = balanceOf(address(this));
        _treasury = balanceOf(treasuryAddress);
    }

    /**
     * @dev 获取合约状态信息
     */
    function getContractStatus() external view returns (
        bool _paused,
        uint256 _totalSupply,
        uint256 _activeClaimers,
        uint256 _activeMeshes,
        uint256 _totalBurn
    ) {
        _paused = paused();
        _totalSupply = totalSupply();
        _activeClaimers = activeClaimers;
        _activeMeshes = activeMeshes;
        _totalBurn = totalBurn;
    }
}
