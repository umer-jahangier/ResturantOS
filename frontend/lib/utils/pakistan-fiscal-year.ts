/** Pakistan FY (Jul–Jun): label = calendar year of the June end month. */
export function currentPakistanFiscalYear(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear();
}
