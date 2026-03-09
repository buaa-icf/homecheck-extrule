# Code Clone Type-2 Check

## 描述

检测方法级 Type-2 克隆：代码结构一致，但允许标识符重命名。

## 默认参数

继承 Type-1 全部参数，并增加：

- `ignoreLiterals`: `false`

## 配置示例

```json
{
  "rules": {
    "@extrulesproject/code-clone-type2-check": {
      "level": 2,
      "options": {
        "minStmts": 6,
        "ignoreLiterals": true,
        "ignoreLogs": true
      }
    }
  }
}
```

## 说明

- `ignoreLiterals=true` 会提升召回率，也可能引入语义不同的误报。
- 当 `similarityThreshold < 1.0` 时，会报告近似克隆并显示相似度百分比。
