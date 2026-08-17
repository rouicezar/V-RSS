import { Test } from '@nestjs/testing';
import { EventsService } from './events.service';

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EventsService],
    }).compile();
    service = moduleRef.get(EventsService);
  });

  it('emit 后订阅者同步收到事件', () => {
    const listener = jest.fn();
    service.subscribe(listener);
    service.emit({ type: 'article:upserted', data: { id: 'a1' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: 'article:upserted',
      data: { id: 'a1' },
    });
  });

  it('多个订阅者都收到同一事件', () => {
    const a = jest.fn();
    const b = jest.fn();
    service.subscribe(a);
    service.subscribe(b);
    service.emit({ type: 'job:started', data: { job: 'tagAll', total: 3 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('取消订阅后不再收到事件', () => {
    const listener = jest.fn();
    const unsubscribe = service.subscribe(listener);
    unsubscribe();
    service.emit({ type: 'job:finished', data: { job: 'tagAll' } });
    expect(listener).not.toHaveBeenCalled();
  });
});
