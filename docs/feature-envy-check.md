# Feature Envy Check

## 描述

检测方法是否存在对其他类的过度依赖（Feature Envy）。

当前规则基于三指标判定：

`ATFD > 4.0 && LDA < 0.33 && CPFD <= 2.0`

当一个方法频繁访问少量外部提供者，同时几乎不操作自身数据时，说明行为可能放错了位置，应考虑将逻辑迁移到被依赖类，或提取协作对象来承载相关行为。

## 默认阈值

- `ATFD`：**4.0**
- `LDA`：**0.33**
- `CPFD`：**2.0**

## 指标说明

- `ATFD`（Access To Foreign Data）：方法对外部提供者的交互次数。当前实现统计外部实例方法调用，以及真正落在外部对象上的字段访问。
- `LDA`（Locality of Data Access）：本地数据访问占全部数据访问的比例。只将真正落在当前类本地状态上的访问计为 local access。
- `CPFD`（Count of Providers of Foreign Data）：方法访问到的外部提供者数量。

> 为避免把 `this.gateway` 这类“导航到依赖对象”的中间读取误判为本地内聚，当前实现不会将此类依赖导航计入 `LDA`。

## 配置方式

支持在 `ruleConfig.json` 中同时调整严重级别与阈值参数：

```json
{
  "rules": {
    "@extrulesproject/feature-envy-check": {
      "level": 2,
      "options": {
        "atfdThreshold": 4,
        "ldaThreshold": 0.33,
        "cpfdThreshold": 2
      }
    }
  }
}
```

**配置参数说明**：
- `atfdThreshold`：`ATFD` 判定阈值，规则要求 `ATFD > atfdThreshold`
- `ldaThreshold`：`LDA` 判定阈值，规则要求 `LDA < ldaThreshold`
- `cpfdThreshold`：`CPFD` 判定阈值，规则要求 `CPFD <= cpfdThreshold`

## 反例代码

```typescript
class OrderService {
  process(order: Order) {
    // 频繁依赖少量外部提供者，同时几乎不操作自身状态
    const limit = this.gateway.fetchLimit(order.userId);
    const confirmedLimit = this.gateway.fetchLimit(order.userId);
    if (confirmedLimit < order.amount) {
      return false;
    }
    const charged = this.gateway.charge(order.userId, order.amount);
    if (order.amount > limit / 2) {
      this.gateway.refund(order.userId, order.amount / 2);
    }
    this.gateway.refund(order.userId, 0);
  }
}
```

## 正例代码

```typescript
class PaymentGateway {
  process(order: Order) {
    const limit = this.fetchLimit(order.userId);
    if (limit < order.amount) {
      return false;
    }
    const charged = this.charge(order.userId, order.amount);
    if (order.amount > limit / 2) {
      this.refund(order.userId, order.amount / 2);
    }
    this.refund(order.userId, 0);
    return charged;
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
