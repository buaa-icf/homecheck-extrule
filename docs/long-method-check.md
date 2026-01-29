# Long Method Check

## 描述

检测方法是否过长。过长的方法通常存在以下问题：

1. **难以理解和维护**：包含过多逻辑的方法难以阅读和理解
2. **违反单一职责原则**：一个方法应该只做一件事
3. **难以测试**：过长的方法包含多个测试场景
4. **难以复用**：小方法更容易被复用

## 默认阈值

- 默认最大语句数：**50 个**语句节点
- 语句数量包括方法体内的所有可执行语句（包括控制流中的嵌套语句）

## 配置方式

在 `ruleConfig.json` 中可以自定义阈值：

```json
{
  "rules": {
    "@extrulesproject/long-method-check": {
      "level": 2,
      "options": {
        "maxStmts": 80
      }
    }
  }
}
```

**配置参数说明**：
- `maxStmts`：方法允许的最大语句数量（默认：50）
- `maxLines`：与 `maxStmts` 同义的别名参数

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
