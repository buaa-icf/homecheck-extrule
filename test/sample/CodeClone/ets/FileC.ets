// FileC.ets - 不包含克隆代码，用于对照测试

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
