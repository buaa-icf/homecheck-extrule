# Code Clone Fragment Check

## 描述

基于 Token 滑动窗口与滚动哈希检测片段级克隆，支持跨方法、跨文件重复代码识别。

## 默认参数

- `minimumTokens`: `100`
- `normalizeIdentifiers`: `true`
- `normalizeLiterals`: `false`
- `ignoreLogs`: `true`
- `ignoreTypes`: `false`
- `ignoreDecorators`: `false`
- `minDistinctTokenTypes`: `3`
- `enableCloneClasses`: `false`
- `similarityThreshold`: `1.0`

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
        "ignoreLogs": true
      }
    }
  }
}
```

## 说明

- `similarityThreshold < 1.0` 时启用 Type-3 近似克隆检测。
- `enableCloneClasses=true` 时，结果按克隆类聚合输出。
