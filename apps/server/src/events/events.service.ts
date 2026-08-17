import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

/**
 * 实时进度事件（SSE 推送协议）
 * 服务端采集/打标任务运行期间逐条广播，前端据此就地更新列表与进度。
 */
export type ServerEvent =
  | { type: 'article:upserted'; data: Record<string, unknown> }
  | {
      type: 'article:tagged';
      data: { articleId: string; tags: string[]; domain: string };
    }
  | {
      type: 'job:started';
      data: {
        job: 'refreshAll' | 'history' | 'tagAll';
        mpId?: string;
        total: number;
      };
    }
  | {
      type: 'job:progress';
      data: {
        job: 'refreshAll' | 'history' | 'tagAll';
        mpId?: string;
        current: number;
        total: number;
        detail?: string;
      };
    }
  | {
      type: 'job:finished';
      data: {
        job: 'refreshAll' | 'history' | 'tagAll';
        mpId?: string;
        result?: Record<string, unknown>;
      };
    };

/**
 * 进程内事件总线：任务模块 emit，SSE 控制器订阅后推给浏览器。
 * @Global() 提供，任何 Service 均可注入。
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly subject = new Subject<ServerEvent>();

  /** 广播一条事件（同步，多消费者共享） */
  emit(event: ServerEvent) {
    this.subject.next(event);
  }

  /** 订阅事件流，返回取消订阅函数（连接断开时调用） */
  subscribe(listener: (event: ServerEvent) => void): () => void {
    const subscription = this.subject.subscribe(listener);
    return () => subscription.unsubscribe();
  }
}
