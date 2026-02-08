# 代码克隆检测测试用例

## 目录结构

```
CodeClone/
├── positive/                    # 正向测试：应该被检测到的克隆
│   ├── type1/                   # Type-1: 完全相同的代码
│   │   ├── FileA.ets           
│   │   └── FileB.ets           
│   ├── type2_identifier/        # Type-2: 标识符重命名
│   │   ├── FileD.ets           
│   │   └── FileE.ets           
│   ├── type2_literal/           # Type-2: 字面量替换 (需配置)
│   │   ├── Config1.ets         
│   │   └── Config2.ets         
│   ├── type1_with_logs/         # Type-1: 业务逻辑相同，日志不同
│   │   ├── LogFileA.ets         # 使用 console.*
│   │   └── LogFileB.ets         # 使用 hilog.*, Logger.*
│   └── type2_with_logs/         # Type-2: 标识符重命名 + 日志不同
│       ├── Type2LogA.ets        # 使用 console.*
│       └── Type2LogB.ets        # 使用 hilog.*
├── negative/                    # 负向测试：不应该被检测为克隆
│   ├── control/                 # 对照组：完全不同的代码
│   │   └── FileC.ets           
│   └── similar_but_different/   # 误报测试：结构相似但语义不同
│       ├── Calculator.ets      
│       └── Counter.ets         
├── expected.json                # 期望结果定义
└── README.md                    # 本文件
```

## 文件标注格式

每个测试文件头部包含标注信息：

```
// @file: 文件名
// @category: 分类路径 (如 positive/type1)
// @expect: 期望结果 (clone-with XXX 或 no-clone)
// @clone-type: 克隆类型
// @description: 描述
// @methods-cloned: 被克隆的方法列表
// @requires: 需要的配置项 (可选)
```

## 测试用例说明

### Positive (应检测到)

1. **type1/**: Type-1 克隆测试
   - FileA.ets 和 FileB.ets 包含完全相同的方法
   - 应检测到: calculateTotal, formatPrice, validateInput

2. **type2_identifier/**: Type-2 标识符重命名测试
   - FileD.ets 和 FileE.ets 结构相同，变量名/函数名不同
   - 应检测到: calculateTotal↔computeSum 等

3. **type2_literal/**: Type-2 字面量替换测试
   - Config1.ets 和 Config2.ets 结构相同，仅字面量值不同
   - **需要开启 ignoreLiterals 配置**
   - 应检测到: getTimeout, getMessage, isEnabled

4. **type1_with_logs/**: Type-1 日志过滤测试
   - LogFileA.ets 和 LogFileB.ets 业务逻辑完全相同
   - LogFileA 使用 `console.log/info`，LogFileB 使用 `hilog.info` 和 `Logger.debug`
   - **ignoreLogs 默认开启**，会过滤日志语句
   - 应检测到: processData, calculateSum

5. **type2_with_logs/**: Type-2 日志过滤测试
   - Type2LogA.ets 和 Type2LogB.ets 业务结构相同，变量名不同，日志库不同
   - 应检测到: handleRequest↔processInput

### Negative (不应检测到)

1. **control/**: 对照组
   - FileC.ets 包含完全不同的代码
   - 不应被检测为任何克隆

2. **similar_but_different/**: 误报风险演示
   - Calculator.ets 和 Counter.ets 结构相似但语义不同
   - **用于演示 `ignoreLiterals` 配置可能带来的误报风险**
   - 详见下方"ignoreLiterals 配置说明"

---

## 设计决策

### 单字母变量不规范化

在标识符规范化过程中，**单字母变量（如 `i`、`j`、`x`、`a`、`b`）不会被替换**。

**设计原因**：
- 单字母变量通常是循环变量或临时变量
- 在不同代码中经常重复出现（如 `for (let i = 0; ...)`)
- 如果把它们也规范化，可能导致**过度匹配**

**代码实现**（在 `normalizeIdentifiers()` 中）：
```typescript
if (match.length <= 1) {
    return match;  // 保持原样，不替换
}
```

**实际影响**：

以 `Calculator.ets` 和 `Counter.ets` 为例：

```typescript
// Calculator.ets
add(a: number, b: number)     // a, b 是单字母，不会被规范化

// Counter.ets  
increment(step: number, max: number)  // step, max 会被规范化为 ID_1, ID_2
```

规范化后：
- Calculator: `add(a, b)` → 保持 `a`, `b`
- Counter: `increment(step, max)` → 变成 `ID_1`, `ID_2`

**结构不同**，所以即使开启 `ignoreLiterals`，这两个方法也不会被误检为克隆。

这是一个**意外的保护机制**：单字母变量的存在反而减少了误报。

---

## ignoreLogs 配置说明

### 什么是 ignoreLogs？

`ignoreLogs` 是克隆检测的一个**配置项**，用于控制是否在哈希计算时忽略日志语句。

| 配置值 | 行为 | 默认 |
|--------|------|------|
| `true` | 过滤日志语句，不参与克隆检测 | ✅ 默认 |
| `false` | 日志语句参与克隆检测 | - |

### 为什么默认开启？

日志语句（`console.log`、`hilog.info`、`Logger.debug` 等）通常只是调试信息，**不影响业务逻辑**。不同开发者可能使用不同的日志库，或者日志消息不同，但这不代表代码逻辑不同。

**示例**：

```typescript
// LogFileA.ets
processData(data: number[]): number {
    console.log("开始处理数据")  // <- 日志
    let result = 0
    for (let i = 0; i < data.length; i++) {
        result = result + data[i]
    }
    console.log("处理完成")      // <- 日志
    return result
}

// LogFileB.ets
processData(data: number[]): number {
    hilog.info("Starting")      // <- 不同的日志库和消息
    let result = 0
    for (let i = 0; i < data.length; i++) {
        result = result + data[i]
    }
    hilog.info("Done")          // <- 不同的日志库和消息
    return result
}
```

这两个方法的**业务逻辑完全相同**，只是日志不同。开启 `ignoreLogs` 后，会正确检测为 Type-1 克隆。

### 什么是"纯日志语句"？

只有**纯日志语句**会被过滤。纯日志语句定义为：整行代码只有日志调用，没有其他业务逻辑。

**会被过滤的语句**：
```typescript
console.log("hello")           // ✅ 纯日志
hilog.info("processing...")    // ✅ 纯日志
Logger.debug("value: " + x)    // ✅ 纯日志
```

**不会被过滤的语句**：
```typescript
let result = validate() && console.log("ok")  // ❌ 嵌在表达式中
if (debug) console.log("debug mode")          // ❌ 条件语句
```

### 支持的日志模式

| 模式 | 示例 | 说明 |
|------|------|------|
| `console.*` | `console.log()`, `console.info()`, `console.warn()`, `console.error()`, `console.debug()` | JavaScript/TypeScript 标准 |
| `hilog.*` | `hilog.info()`, `hilog.debug()`, `hilog.warn()`, `hilog.error()` | HarmonyOS 系统日志 |
| `Logger.*` | `Logger.info()`, `Logger.debug()`, `Logger.warn()`, `Logger.error()` | 项目自定义封装 |

### 如何关闭？

在 `ruleConfig.json` 中配置：

```json
{
  "extRuleSet": [
    {
      "ruleSetName": "extrulesproject",
      "packagePath": "./homecheck-extrule",
      "extRules": {
        "@extrulesproject/code-clone-type1-check": ["error", {
          "minStmts": 5,
          "ignoreLogs": false
        }]
      }
    }
  ]
}
```

---

## ignoreLiterals 配置说明

### 什么是 ignoreLiterals？

`ignoreLiterals` 是 Type-2 克隆检测的一个**可选配置项**，用于控制是否忽略字面量（数字、字符串）的差异。

| 配置值 | 行为 | 默认 |
|--------|------|------|
| `false` | 只检测标识符重命名的克隆 | ✅ 默认 |
| `true` | 同时检测字面量替换的克隆 | - |

### 为什么默认关闭？

开启 `ignoreLiterals` 后，会增加**误报风险**。以 `similar_but_different/` 目录下的测试用例为例：

**Calculator.ets - add() 方法：**
```typescript
add(a: number, b: number): number {
    let result = a + b
    if (result > 1000) { result = 1000 }
    return result
}
```

**Counter.ets - increment() 方法：**
```typescript
increment(step: number, max: number): number {
    let result = step + max
    if (result > 100) { result = 100 }
    return result
}
```

这两个方法：
- **语义完全不同**：一个是数学加法计算，一个是计数器增加
- **结构相同**：都是两个参数相加，判断是否超过阈值

| 配置 | 检测结果 | 是否正确 |
|------|----------|----------|
| `ignoreLiterals: false` | 不检测为克隆 | ✅ 正确 |
| `ignoreLiterals: true` | 检测为克隆 | ⚠️ **误报** |

### 什么时候应该开启？

建议在以下场景开启 `ignoreLiterals`：

1. **配置类代码**：如 `Config1.ets` 和 `Config2.ets`，只有配置值不同
2. **模板代码**：复制粘贴后只改了常量值
3. **可接受一定误报**：愿意人工筛选结果

### 如何使用？

在 `ruleConfig.json` 中配置：

```json
{
  "extRuleSet": [
    {
      "ruleSetName": "extrulesproject",
      "packagePath": "./homecheck-extrule",
      "extRules": {
        "@extrulesproject/code-clone-type2-check": ["error", {
          "minStmts": 5,
          "ignoreLiterals": true
        }]
      }
    }
  ]
}
```

---

## 运行测试

```bash
# 运行单元测试
npm test

# 运行 Type-1 检测
homecheck --rule code-clone-type1-check

# 运行 Type-2 检测 (默认，不含字面量规范化)
homecheck --rule code-clone-type2-check

# 运行 Type-2 检测 (开启字面量规范化)
# 需在 ruleConfig.json 中配置 ignoreLiterals: true
```

## 验证期望结果

参考 `expected.json` 中定义的期望结果，验证检测输出是否匹配。

`expected.json` 中的 `similar_but_different` 部分详细说明了不同配置下的期望行为。
