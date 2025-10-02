import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<Map<string, any>>();

  run(callback: () => any) {
    this.als.run(new Map(), callback);
  }

  set(key: string, value: any) {
    const store = this.als.getStore();
    if (store) {
      store.set(key, value);
    }
  }

  get(key: string): any {
    const store = this.als.getStore();
    return store ? store.get(key) : undefined;
  }
}
