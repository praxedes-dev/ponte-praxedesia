/**
 * Attempts to repair a truncated JSON string by closing open quotes, brackets, and braces.
 * Extremely useful for handling LLM responses that cut off due to token limits.
 */
export function healTruncatedJSON(text: string): string {
  if (!text.trim()) return text;

  let healed = text.trim();
  
  // 1. Close open strings
  let inString = false;
  let escaped = false;
  for (let i = 0; i < healed.length; i++) {
    const char = healed[i];
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = false;
  }
  
  if (inString) {
    // If we're inside a string, close it. 
    // If the last character was a backslash, remove it first as it's an incomplete escape.
    if (healed.endsWith('\\')) healed = healed.slice(0, -1);
    healed += '"';
  }

  // 2. Track open braces and brackets
  const stack: string[] = [];
  inString = false;
  escaped = false;
  
  for (let i = 0; i < healed.length; i++) {
    const char = healed[i];
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') stack.pop();
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') stack.pop();
      }
    }
    escaped = false;
  }

  // 3. Fix trailing commas before closing
  // If the last non-whitespace character after healing the string is a comma, remove it.
  healed = healed.trim();
  if (healed.endsWith(',')) {
    healed = healed.slice(0, -1).trim();
  }

  // 4. Close remaining structures in reverse order
  while (stack.length > 0) {
    const last = stack.pop();
    if (last === '{') healed += '}';
    else if (last === '[') healed += ']';
  }

  return healed;
}
