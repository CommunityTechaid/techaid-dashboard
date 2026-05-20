import { Injectable, Optional, Inject, NgZone, Provider } from '@angular/core';
import { HttpInterceptor, HttpEvent, HttpHandler, HttpRequest, HTTP_INTERCEPTORS } from '@angular/common/http';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { NgProgress, NgProgressRef } from 'ngx-progressbar';
import { InjectionToken } from '@angular/core';

export interface AppNgProgressHttpConfig {
  id?: string;
  silentApis?: string[];
}

export const CONFIG = new InjectionToken<AppNgProgressHttpConfig>('config');

@Injectable()
export class AppNgProgressInterceptor implements HttpInterceptor {

  private _inProgressCount = 0;
  private _progressRef: NgProgressRef;
  private _config: AppNgProgressHttpConfig = {
    id: 'root',
    silentApis: []
  };

  constructor(private ngProgress: NgProgress, private zone: NgZone, @Optional() @Inject(CONFIG) config?: AppNgProgressHttpConfig) {
    this._config = { ...this._config, ...config };
    this._progressRef = ngProgress.ref(this._config.id);
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (this.checkUrl(req)) {
      return next.handle(req);
    }

    this._inProgressCount++;
    this.zone.run(() => {
      if (!this._progressRef.isStarted) {
        this._progressRef.start();
      }
    });

    return next.handle(req).pipe(
      finalize(() => {
        this._inProgressCount--;
        this.zone.run(() => {
          if (this._inProgressCount === 0) {
            this._progressRef.complete();
          }
        });
      })
    );
  }

  private checkUrl(req: HttpRequest<any>) {
    const url = req.url.toLowerCase();
    const found = this._config.silentApis.find((u) => url.startsWith(u));
    return !!found;
  }
}

export function provideNgProgressHttp(config?: AppNgProgressHttpConfig): Provider[] {
  return [
    { provide: CONFIG, useValue: config },
    { provide: HTTP_INTERCEPTORS, useClass: AppNgProgressInterceptor, multi: true }
  ];
}
