# 任务：TeamBattle 合约

## 背景与约束
- 基于 Meshes 合约风格，独立新增 TeamBattle 合约。
- 团队规则：蓝/橙阵营不可逆选择；heat 正负代表阵营；易守难攻。
- Claim 使用 MESH 代币燃烧成本；Attack 使用合约内 Points 记账。
- 仅新增合约，不修改 Meshes。

## 关键假设
- MESH “燃烧”通过 transferFrom 转入 0x000000000000000000000000000000000000dEaD。
- 初次中立 claim 成本为 0；中立被攻占后 capture 成本为基础燃烧成本。
- 攻击成本 = attackBaseCost * absHeat * attackMultiplier。
- quoteCost 对齐 Meshes 的 quoteClaimCost 风格，仅返回 claim 成本。

## 执行计划
1. 新增 TeamBattle.sol：结构、存储与事件。
2. 实现 claim/attack/capture 与查询接口。
3. 实现治理/暂停/安全与参数配置。
4. 补充 meshID 校验与 heat 编解码工具。
