// ============================================================
// @file: FileC.ets
// @category: negative/control
// @expect: no-clone
// @clone-type: N/A
// @description: 完全独立的代码，不应被检测为任何克隆
// ============================================================

@Component
struct PageC {
  @State message: string = "独立页面"

  build() {
    Column() {
      Text(this.message)
        .fontSize(16)
    }
  }

  // 完全不同的方法，不应该被检测为克隆
  processData(data: string): string {
    let result = data.trim()
    result = result.toLowerCase()
    return result
  }

  computeAverage(numbers: number[]): number {
    if (numbers.length === 0) {
      return 0
    }
    let sum = 0
    for (let n of numbers) {
      sum += n
    }
    return sum / numbers.length
  }
}
