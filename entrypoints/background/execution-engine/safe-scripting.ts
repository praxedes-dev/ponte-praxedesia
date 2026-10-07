export async function safeExecuteScript<T extends (...args: any[]) => any>(
  params: chrome.scripting.ScriptInjection<any[], ReturnType<T>>
): Promise<chrome.scripting.InjectionResult<chrome.scripting.Awaited<ReturnType<T>>>[]> {
  try {
    const result = await chrome.scripting.executeScript({
      ...params,
    });
    return result;
  } catch (err) {
    console.warn('[safeExecuteScript] Ignored execution error:', err);
    return [];
  }
}
