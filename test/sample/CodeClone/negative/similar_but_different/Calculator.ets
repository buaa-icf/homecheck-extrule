// ============================================================
// @file: Calculator.ets
// @category: negative/similar_but_different
// @purpose: 演示 ignoreLiterals 配置的误报风险
// 
// @expect-when ignoreLiterals=false: no-clone (正确)
// @expect-when ignoreLiterals=true:  clone-with Counter.ets (误报!)
//
// @clone-type: N/A (语义不同，不是真正的克隆)
// @description: 与 Counter.ets 结构相似，但语义完全不同
//               - Calculator: 数学计算（加法、乘法、除法）
//               - Counter: 计数器操作（增加、重置、获取）
//               开启 ignoreLiterals 后会被误检为克隆
// ============================================================

@Component
struct Calculator {
  @State value: number = 0

  build() {
    Column() {
      Text("计算器")
    }
  }

  // 加法运算 - 结构上与 Counter.increment 类似
  // 但业务含义不同（数学运算 vs 计数器）
  add(a: number, b: number): number {
    let result = a + b
    if (result > 1000) {
      result = 1000
    }
    return result
  }

  // 乘法运算 - 也是数学运算
  multiply(a: number, b: number): number {
    let result = a * b
    if (result > 10000) {
      result = 10000
    }
    return result
  }

  // 除法运算
  divide(a: number, b: number): number {
    if (b === 0) {
      return 0
    }
    let result = a / b
    return result
  }
}
