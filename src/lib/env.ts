/** Chrome 확장 프로그램 환경인지 여부 */
export const IS_EXT =
  typeof chrome !== 'undefined' &&
  typeof chrome.runtime !== 'undefined' &&
  !!chrome.runtime.id
