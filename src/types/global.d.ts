import type { AxiosInstance } from 'axios';
import type { route as appRoute } from '@/lib/route';

declare global {
  interface Window {
    axios?: AxiosInstance;
    __APP_NAME__?: string;
    route: typeof appRoute;
  }

  var route: typeof appRoute;
}

export {};
