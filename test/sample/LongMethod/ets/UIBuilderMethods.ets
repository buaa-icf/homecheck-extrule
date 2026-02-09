// UIBuilderMethods.ets
// Tests for UI method detection: @Builder decorator methods

// === @Builder function (UI method - uses soft/hard threshold) ===
@Builder
function longBuilderFunction() {
  let c0: number = 0
  let c1: number = 1
  let c2: number = 2
  let c3: number = 3
  let c4: number = 4
  let c5: number = 5
  let c6: number = 6
  let c7: number = 7
  let c8: number = 8
  let c9: number = 9
  let c10: number = 10
  let c11: number = 11
  let c12: number = 12
  let c13: number = 13
  let c14: number = 14
  let c15: number = 15
  let c16: number = 16
  let c17: number = 17
  let c18: number = 18
  let c19: number = 19
  let c20: number = 20
  let c21: number = 21
  let c22: number = 22
  let c23: number = 23
  let c24: number = 24
  let c25: number = 25
  let c26: number = 26
  let c27: number = 27
  let c28: number = 28
  let c29: number = 29
  let c30: number = 30
  let c31: number = 31
  let c32: number = 32
  let c33: number = 33
  let c34: number = 34
  let c35: number = 35
  let c36: number = 36
  let c37: number = 37
  let c38: number = 38
  let c39: number = 39
  let c40: number = 40
  let c41: number = 41
  let c42: number = 42
  let c43: number = 43
  let c44: number = 44
  let c45: number = 45
  let c46: number = 46
  let c47: number = 47
  let c48: number = 48
  let c49: number = 49
  let c50: number = 50
  let c51: number = 51
  let c52: number = 52
  let c53: number = 53
  let c54: number = 54
  let c55: number = 55
  let c56: number = 56
  let c57: number = 57
  let c58: number = 58
  let c59: number = 59
  let c60: number = 60
  let c61: number = 61
  let c62: number = 62
  let c63: number = 63
  let c64: number = 64
  let c65: number = 65
  let c66: number = 66
  let c67: number = 67
  let c68: number = 68
  let c69: number = 69
  let c70: number = 70
  let c71: number = 71
  let c72: number = 72
  let c73: number = 73
  let c74: number = 74
  let c75: number = 75
  let c76: number = 76
  let c77: number = 77
  let c78: number = 78
  let c79: number = 79
  let c80: number = 80
  let c81: number = 81
  let c82: number = 82
  let c83: number = 83
  let c84: number = 84
  let c85: number = 85
  let c86: number = 86
  let c87: number = 87
  let c88: number = 88
  let c89: number = 89
}

// === Short @Builder function (should NOT trigger) ===
@Builder
function shortBuilderFunction() {
  let x: number = 1
  let y: number = 2
}
