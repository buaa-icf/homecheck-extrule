// NormalMethods.ets
// Tests for normal (non-UI) method long method detection
// Default threshold: 50 statements

// === POSITIVE: Normal method exceeding default threshold (should trigger) ===
class NormalLongClass {
  longMethod(): number {
    let a0: number = 0
    let a1: number = 1
    let a2: number = 2
    let a3: number = 3
    let a4: number = 4
    let a5: number = 5
    let a6: number = 6
    let a7: number = 7
    let a8: number = 8
    let a9: number = 9
    let a10: number = 10
    let a11: number = 11
    let a12: number = 12
    let a13: number = 13
    let a14: number = 14
    let a15: number = 15
    let a16: number = 16
    let a17: number = 17
    let a18: number = 18
    let a19: number = 19
    let a20: number = 20
    let a21: number = 21
    let a22: number = 22
    let a23: number = 23
    let a24: number = 24
    let a25: number = 25
    let a26: number = 26
    let a27: number = 27
    let a28: number = 28
    let a29: number = 29
    let a30: number = 30
    let a31: number = 31
    let a32: number = 32
    let a33: number = 33
    let a34: number = 34
    let a35: number = 35
    let a36: number = 36
    let a37: number = 37
    let a38: number = 38
    let a39: number = 39
    let a40: number = 40
    let a41: number = 41
    let a42: number = 42
    let a43: number = 43
    let a44: number = 44
    let a45: number = 45
    let a46: number = 46
    let a47: number = 47
    let a48: number = 48
    let a49: number = 49
    let a50: number = 50
    let a51: number = 51
    let a52: number = 52
    let a53: number = 53
    let a54: number = 54
    let a55: number = 55
    let a56: number = 56
    let a57: number = 57
    let a58: number = 58
    let a59: number = 59
    return a59
  }
}

// === NEGATIVE: Normal method under threshold (should NOT trigger) ===
class NormalShortClass {
  shortMethod(): number {
    let x: number = 1
    let y: number = 2
    let z: number = 3
    return x + y + z
  }
}

// === Standalone function (non-class, non-UI) ===
function standaloneLongFunction(): number {
  let b0: number = 0
  let b1: number = 1
  let b2: number = 2
  let b3: number = 3
  let b4: number = 4
  let b5: number = 5
  let b6: number = 6
  let b7: number = 7
  let b8: number = 8
  let b9: number = 9
  let b10: number = 10
  let b11: number = 11
  let b12: number = 12
  let b13: number = 13
  let b14: number = 14
  let b15: number = 15
  let b16: number = 16
  let b17: number = 17
  let b18: number = 18
  let b19: number = 19
  let b20: number = 20
  let b21: number = 21
  let b22: number = 22
  let b23: number = 23
  let b24: number = 24
  let b25: number = 25
  let b26: number = 26
  let b27: number = 27
  let b28: number = 28
  let b29: number = 29
  let b30: number = 30
  let b31: number = 31
  let b32: number = 32
  let b33: number = 33
  let b34: number = 34
  let b35: number = 35
  let b36: number = 36
  let b37: number = 37
  let b38: number = 38
  let b39: number = 39
  let b40: number = 40
  let b41: number = 41
  let b42: number = 42
  let b43: number = 43
  let b44: number = 44
  let b45: number = 45
  let b46: number = 46
  let b47: number = 47
  let b48: number = 48
  let b49: number = 49
  let b50: number = 50
  let b51: number = 51
  let b52: number = 52
  let b53: number = 53
  let b54: number = 54
  let b55: number = 55
  let b56: number = 56
  let b57: number = 57
  let b58: number = 58
  let b59: number = 59
  return b59
}
