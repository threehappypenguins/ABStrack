export class ConversionService {
  // Convert mg/dL to mmol/L for blood alcohol concentration
  static mgDLToMmolL(mgDL: number): number {
    // 1 mg/dL = 0.217 mmol/L (approximate conversion for ethanol)
    return mgDL * 0.217;
  }

  // Convert mmol/L to mg/dL for blood alcohol concentration
  static mmolLToMgDL(mmolL: number): number {
    // 1 mmol/L = 4.608 mg/dL (approximate conversion for ethanol)
    return mmolL * 4.608;
  }

  static formatBACValue(value: number, unit: 'mg/dL' | 'mmol/L'): string {
    if (unit === 'mg/dL') {
      return `${value.toFixed(2)} mg/dL`;
    } else {
      return `${value.toFixed(3)} mmol/L`;
    }
  }
}