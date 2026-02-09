# Long Method Check

## 描述

检测方法是否过长。过长的方法通常存在以下问题：

1. **难以理解和维护**：包含过多逻辑的方法难以阅读和理解
2. **违反单一职责原则**：一个方法应该只做一件事
3. **难以测试**：过长的方法包含多个测试场景
4. **难以复用**：小方法更容易被复用

## 默认阈值

### 普通函数

- 默认最大语句数：**50 个**语句节点
- 语句数量包括方法体内的所有可执行语句（包括控制流中的嵌套语句）

### UI 组装/渲染/构建类函数

对于 UI 类方法，采用软/硬双阈值策略，允许更宽松的长度限制：

- **软阈值**：**80 个**语句节点（超过时以 warning 级别上报）
- **硬阈值**：**120 个**语句节点（超过时以 error 级别上报）

以下方法被视为 UI 类方法：
- `@Component` struct 中的 `build()` 方法
- 带有 `@Builder` 装饰器的方法
- 关联了 ViewTree 的方法
- `@Component` struct 中的 UI 生命周期方法（`aboutToAppear`、`aboutToDisappear`、`onPageShow`、`onPageHide`、`onBackPress`）

## 配置方式

在 `ruleConfig.json` 中可以自定义阈值：

```json
{
  "rules": {
    "@extrulesproject/long-method-check": {
      "level": 2,
      "options": {
        "maxStmts": 50,
        "maxUIStmtsSoft": 80,
        "maxUIStmtsHard": 120
      }
    }
  }
}
```

**配置参数说明**：
- `maxStmts`：普通方法允许的最大语句数量（默认：50）
- `maxLines`：与 `maxStmts` 同义的别名参数
- `maxUIStmtsSoft`：UI 类方法的软阈值，超过时以 warning 上报（默认：80）
- `maxUIStmtsHard`：UI 类方法的硬阈值，超过时以 error 上报（默认：120）

## 反例代码

```typescript
// 方法过长，包含超过 50 个语句
class UserService {
  processUserData(user: User): void {
    // 大量业务逻辑...
    // 语句数超过 50 个
    // 包含数据处理、验证、存储等多个职责
  }
}
```

## 正例代码

```typescript
// 将长方法拆分为多个小方法
class UserService {
  processUserData(user: User): void {
    this.validateUser(user);
    this.transformUser(user);
    this.saveUser(user);
  }

  private validateUser(user: User): void {
    // 验证逻辑
  }

  private transformUser(user: User): void {
    // 转换逻辑
  }

  private saveUser(user: User): void {
    // 存储逻辑
  }
}
```

## 参考文献

- Martin Fowler, "Refactoring: Improving the Design of Existing Code", Chapter 1
- Robert C. Martin, "Clean Code", Chapter 3: Functions
