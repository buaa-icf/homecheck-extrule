# ExtraRuleProject

ArkTS 代码检查自定义规则项目，基于 [homecheck](https://gitcode.com/openharmony-sig/homecheck) 框架开发的扩展规则。

## 功能特性

- **Long Method Check** (`@extrulesproject/long-method-check`)
  - 检测方法语句数量超过阈值的方法
  - 普通函数：默认 50 个语句节点
  - UI 组装/渲染/构建类函数（build、@Builder、含 ViewTree 的方法等）：
    - 软阈值：80 个语句节点（severity 降为 warning）
    - 硬阈值：120 个语句节点（保持原 severity）

- **Code Clone Fragment Check** (`@extrulesproject/code-clone-fragment-check`)
  - 基于 Token 滑动窗口 + Rabin-Karp 滚动哈希的代码片段级克隆检测，可跨方法边界发现重复片段
  - 支持标识符/字面量规范化、日志过滤、克隆类聚合与 Type-3 近似片段检测

## 规则配置参数

在 `ruleConfig.json` 的 `extRules` 字段中配置各规则，格式为 `["warn/error/suggestion", { ...options }]`。

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
| `maxPairsPerFingerprint` | number | `5000` | 单个规范化 Token 指纹最多展开的候选克隆对数量，用于限制高频样板片段的二次方爆炸 |

配置示例：

```json
"@extrulesproject/code-clone-fragment-check": ["error", {
  "minimumTokens": 80,
  "normalizeIdentifiers": true,
  "normalizeLiterals": true,
  "maxPairsPerFingerprint": 3000
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
