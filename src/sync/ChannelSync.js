/**
 * ChannelSync.js - Sub-millisecond cross-window synchronization via BroadcastChannel.
 * Coordinates state seamlessly between the Operator Console (Display 1) and Fullscreen Projector (Display 2).
 */
export class ChannelSync {
  constructor(isProjectorWindow = false, onMessageReceived = null) {
    this.isProjectorWindow = isProjectorWindow;
    this.onMessageReceived = onMessageReceived;
    this.channel = new BroadcastChannel('projectionfx_sync');

    this.channel.onmessage = (event) => {
      if (this.onMessageReceived) {
        this.onMessageReceived(event.data);
      }
    };
  }

  send(type, payload) {
    this.channel.postMessage({
      type,
      payload,
      timestamp: performance.now(),
      sender: this.isProjectorWindow ? 'projector' : 'console'
    });
  }

  close() {
    this.channel.close();
  }
}
