# Feature Envy Check

## 描述

检测方法是否存在对其他类的过度依赖（Feature Envy）。如果一个方法对单一外部类的调用次数远超自身类，可能应将逻辑移动到被依赖的类，或提取协作对象来承载相关行为。

## 默认阈值

- 最少统计的调用数：**3**（低于此值不报告）
- 最少外部调用数：**3**（外部调用少于 3 不报告）
- 外部调用比例：**60%** 及以上，且外部调用次数大于自身类的调用次数

> 调用计数基于方法体内的语句，识别每个调用的目标类，再按类进行统计。

## 配置方式

当前仅支持在 `ruleConfig.json` 中调整严重级别（`level`）。阈值（最少调用数、比例等）在规则内置，不支持自定义：

```json
{
  "rules": {
    "@extrulesproject/feature-envy-check": {
      "level": 2
    }
  }
}
```

## 反例代码

```typescript
class OrderService {
  process(order: Order) {
    // 大量依赖外部类 PaymentGateway
    this.gateway.validate(order);
    this.gateway.prepare(order);
    this.gateway.charge(order);
    this.gateway.confirm(order);
    this.gateway.notify(order);
  }
}
```

## 正例代码

```typescript
class PaymentGateway {
  process(order: Order) {
    this.validate(order);
    this.prepare(order);
    this.charge(order);
    this.confirm(order);
    this.notify(order);
  }
}

class OrderService {
  process(order: Order) {
    // 委派给更合适的类
    this.gateway.process(order);
  }
}
```

## 参考文献

- Martin Fowler, "Refactoring: Improving the Design of Existing Code"（Feature Envy）
- Robert C. Martin, "Clean Code"，Chapter 7: Error Handling
