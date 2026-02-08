// ============================================================
// @file: LogFileB.ets
// @category: positive/type1_with_logs
// @expect: clone-with LogFileA.ets (需开启 ignoreLogs)
// @clone-type: Type-1 (完全相同，日志不同)
// @description: 与 LogFileA.ets 业务逻辑完全相同，但使用不同日志库
// @methods-cloned: processData, calculateSum
// @requires: ignoreLogs = true (默认开启)
// ============================================================

@Component
struct LogFileB {
  build() {
    Column() {
      Text("日志测试B")
    }
  }

  // 业务逻辑相同，但使用 hilog
  processData(data: number[]): number {
    hilog.info("Starting data processing")
    let result = 0
    for (let i = 0; i < data.length; i++) {
      result = result + data[i]
    }
    hilog.info("Processing completed")
    return result
  }

  // 另一个方法，使用 Logger
  calculateSum(items: number[]): number {
    Logger.debug("Calculation started")
    let sum = 0
    for (let item of items) {
      if (item > 0) {
        sum = sum + item
      }
    }
    Logger.debug("Calculation finished, result: " + sum)
    return sum
  }
}
