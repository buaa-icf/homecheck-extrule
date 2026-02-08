// ============================================================
// @file: LogFileA.ets
// @category: positive/type1_with_logs
// @expect: clone-with LogFileB.ets (需开启 ignoreLogs)
// @clone-type: Type-1 (完全相同，日志不同)
// @description: 与 LogFileB.ets 业务逻辑完全相同，仅日志调用不同
// @methods-cloned: processData, calculateSum
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct LogFileA {
  build() {
    Column() {
      Text("日志测试A")
    }
  }

  // 业务逻辑相同，但使用 console.log
  processData(data: number[]): number {
    console.log("开始处理数据")
    let result = 0
    for (let i = 0; i < data.length; i++) {
      result = result + data[i]
    }
    console.log("处理完成")
    return result
  }

  // 另一个方法，使用 console.info
  calculateSum(items: number[]): number {
    console.info("计算开始")
    let sum = 0
    for (let item of items) {
      if (item > 0) {
        sum = sum + item
      }
    }
    console.info("计算结束，结果：" + sum)
    return sum
  }
}
