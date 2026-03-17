import { RetryConfig } from '../models/types';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  exponentialBackoff: true
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  config?: Partial<RetryConfig>,
  operationName: string = 'operation'
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < finalConfig.maxRetries) {
        const delay = finalConfig.exponentialBackoff
          ? finalConfig.retryDelayMs * Math.pow(2, attempt)
          : finalConfig.retryDelayMs;
        
        console.warn(`${operationName} failed (attempt ${attempt + 1}/${finalConfig.maxRetries + 1}), retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError || new Error(`${operationName} failed after ${finalConfig.maxRetries + 1} attempts`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getDefaultRetryConfig(): RetryConfig {
  return { ...DEFAULT_RETRY_CONFIG };
}
