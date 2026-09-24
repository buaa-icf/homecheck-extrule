# Code Clone Fragment Check

## 描述

基于 Token 滑动窗口与滚动哈希检测片段级克隆，支持跨方法、跨文件重复代码识别。

## 默认参数

- `minimumTokens`: `100`
- `normalizeIdentifiers`: `true`
- `normalizeLiterals`: `true`
- `ignoreLogs`: `true`
- `ignoreImports`: `true`（import 声明不参与 token 阈值和克隆指纹，源码行号保持不变）
- `ignoreTypes`: `false`
- `ignoreDecorators`: `false`
- `minDistinctTokenTypes`: `3`
- `enableCloneClasses`: `false`
- `similarityThreshold`: `1.0`
- `maxPairsPerFingerprint`: `5000`

## 配置示例

```json
{
  "rules": {
    "@extrulesproject/code-clone-fragment-check": {
      "level": 2,
      "options": {
        "minimumTokens": 80,
        "normalizeIdentifiers": true,
        "normalizeLiterals": true,
        "ignoreLogs": true,
        "ignoreImports": true,
        "maxPairsPerFingerprint": 3000
      }
    }
  }
}
```

## 说明

- `similarityThreshold < 1.0` 时启用 Type-3 近似克隆检测。
- `enableCloneClasses=true` 时，结果按克隆类聚合输出。
- `maxPairsPerFingerprint` 保留为旧 pair 展开与 fallback 的候选上限；精确克隆主路径会先将重复 Token 窗口聚合为 clone class，再生成 pair 风格报告，避免高频指纹枚举全部候选对。
