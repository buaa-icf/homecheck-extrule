// ============================================================
// @file: Counter.ets
// @category: negative/similar_but_different
// @purpose: 演示 ignoreLiterals 配置的误报风险
// 
// @expect-when ignoreLiterals=false: no-clone (正确)
// @expect-when ignoreLiterals=true:  clone-with Calculator.ets (误报!)
//
// @clone-type: N/A (语义不同，不是真正的克隆)
// @description: 与 Calculator.ets 结构相似，但语义完全不同
//               - Counter: 计数器操作（增加、重置、获取）
//               - Calculator: 数学计算（加法、乘法、除法）
//               开启 ignoreLiterals 后会被误检为克隆
// ============================================================

@Component
struct Counter {
  @State count: number = 0

  build() {
    Column() {
      Text("计数器")
    }
  }

  // 增加计数 - 结构上与 Calculator.add 类似
  // 但业务含义不同（计数器 vs 数学运算）
  increment(step: number, max: number): number {
    let result = step + max
    if (result > 100) {
      result = 100
    }
    return result
  }

  // 重置计数
  reset(initial: number, offset: number): number {
    let result = initial * offset
    if (result > 1000) {
      result = 1000
    }
    return result
  }

  // 获取计数
  getCount(index: number, total: number): number {
    if (total === 0) {
      return 0
    }
    let result = index / total
    return result
  }
}
