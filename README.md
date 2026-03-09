# ExtraRuleProject

ArkTS 代码检查自定义规则项目，基于 [homecheck](https://gitcode.com/openharmony-sig/homecheck) 框架开发的扩展规则。

## 功能特性

- **Long Method Check** (`@extrulesproject/long-method-check`)
  - 检测方法语句数量超过阈值的方法
  - 普通函数：默认 50 个语句节点
  - UI 组装/渲染/构建类函数（build、@Builder、含 ViewTree 的方法等）：
    - 软阈值：80 个语句节点（severity 降为 warning）
    - 硬阈值：120 个语句节点（保持原 severity）

- **Code Clone Type-1 Check** (`@extrulesproject/code-clone-type1-check`)
  - 基于方法级 AST 指纹的精确克隆（Type-1）检测，识别完全相同的代码片段

- **Code Clone Type-2 Check** (`@extrulesproject/code-clone-type2-check`)
  - 基于方法级 AST 指纹的参数化克隆（Type-2）检测，支持忽略标识符/字面量差异

- **Code Clone Fragment Check** (`@extrulesproject/code-clone-fragment-check`)
  - 基于 Token 滑动窗口 + Rabin-Karp 滚动哈希的代码片段级克隆检测，可跨方法边界发现重复片段

## 规则配置参数

在 `ruleConfig.json` 的 `extRules` 字段中配置各规则，格式为 `["warn/error/suggestion", { ...options }]`。

### CodeCloneType1Check

规则名：`@extrulesproject/code-clone-type1-check`

| 参数 | 类型 | 默认值 | 说明 |
| ------ | ------ | -------- | ------ |
| `minStmts` | number | `6` | 方法最少语句数阈值，低于此值的方法不参与检测 |
| `ignoreLogs` | boolean | `true` | 是否在哈希计算前过滤日志语句（如 `console.log`、`hilog`） |
| `ignoreTypes` | boolean | `false` | 是否忽略类型注解，忽略后类型差异不影响哈希 |
| `ignoreDecorators` | boolean | `false` | 是否忽略装饰器语句 |
| `minComplexity` | number | `0` | 方法最小圈复杂度阈值，低于此值的方法不参与检测 |
| `similarityThreshold` | number | `1.0` | Jaccard 相似度阈值（范围 0~1），设为 `1.0` 表示精确匹配，低于 `1.0` 启用近似克隆检测 |
| `enableCloneClasses` | boolean | `false` | 是否启用克隆类分组报告，将多组克隆对聚合为克隆类 |

配置示例：

```json
"@extrulesproject/code-clone-type1-check": ["error", {
  "minStmts": 6,
  "ignoreLogs": true
}]
```

### CodeCloneType2Check

规则名：`@extrulesproject/code-clone-type2-check`

继承 Type-1 的全部参数，额外支持：

| 参数 | 类型 | 默认值 | 说明 |
| ------ | ------ | -------- | ------ |
| `ignoreLiterals` | boolean | `false` | 是否忽略字面量差异（Type-2 核心参数），设为 `true` 后不同字面量值视为相同 |

配置示例：

```json
"@extrulesproject/code-clone-type2-check": ["error", {
  "minStmts": 6,
  "ignoreLiterals": true,
  "ignoreLogs": true
}]
```

### CodeCloneFragmentCheck

规则名：`@extrulesproject/code-clone-fragment-check`

| 参数 | 类型 | 默认值 | 说明 |
| ------ | ------ | -------- | ------ |
| `minimumTokens` | number | `100` | 最小 Token 数量，滑动窗口大小，片段长度低于此值不报告 |
| `normalizeIdentifiers` | boolean | `true` | 是否将标识符规范化为统一占位符，启用后变量名差异不影响匹配 |
| `normalizeLiterals` | boolean | `false` | 是否将字面量规范化为统一占位符 |
| `ignoreLogs` | boolean | `true` | 是否过滤日志语句的 Token |
| `ignoreTypes` | boolean | `false` | 是否忽略类型注解的 Token |
| `ignoreDecorators` | boolean | `false` | 是否忽略装饰器的 Token |
| `minDistinctTokenTypes` | number | `3` | 最小不同 Token 类型数，低于此值的片段不报告（过滤重复度过高的简单代码） |
| `enableCloneClasses` | boolean | `false` | 是否启用克隆类分组报告 |
| `similarityThreshold` | number | `1.0` | LCS 相似度阈值（范围 0~1），设为 `1.0` 仅报告精确匹配（Type-1/Type-2），低于 `1.0` 启用 Type-3 近似克隆检测 |

配置示例：

```json
"@extrulesproject/code-clone-fragment-check": ["error", {
  "minimumTokens": 80,
  "normalizeIdentifiers": true,
  "normalizeLiterals": true
}]
```

## 安装

参考

- [homecheck 安装与使用指南](https://gitcode.com/openharmony-sig/homecheck/blob/master/document/user/homecheck%E5%AE%89%E8%A3%85%E4%B8%8E%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md)
- [ExtRule 自定义规则开发指南](https://gitcode.com/openharmony-sig/homecheck/blob/master/document/developer/ExtRule%E8%87%AA%E5%AE%9A%E4%B9%89%E8%A7%84%E5%88%99%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md)

## 运行

```bash
npm pack

node ./node_modules/homecheck/lib/run.js --projectConfigPath=./config/projectConfig.json --configPath=./config/ruleConfig.json
```

## 许可证

ISC
