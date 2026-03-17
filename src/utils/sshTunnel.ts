import { createServer, Server } from 'net';
import { Client, ConnectConfig } from 'ssh2';
import { SSHConfig } from '../models/types';

export interface TunnelInfo {
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export class SSHTunnel {
  private sshClient: Client | null = null;
  private localServer: Server | null = null;
  private tunnelInfo: TunnelInfo | null = null;
  private isConnected: boolean = false;

  async connect(sshConfig: SSHConfig, targetHost: string, targetPort: number): Promise<TunnelInfo> {
    return new Promise<TunnelInfo>((resolve, reject) => {
      const sshClient = new Client();
      let settled = false;
      this.sshClient = sshClient;

      const connectConfig: ConnectConfig = {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        readyTimeout: 30000,
      };

      if (sshConfig.password) {
        connectConfig.password = sshConfig.password;
      } else if (sshConfig.privateKey) {
        connectConfig.privateKey = sshConfig.privateKey;
        if (sshConfig.passphrase) {
          connectConfig.passphrase = sshConfig.passphrase;
        }
      }

      sshClient.once('ready', async () => {
        try {
          const localPort = await this.startLocalForwardServer(sshClient, targetHost, targetPort);
          this.tunnelInfo = {
            localPort,
            remoteHost: targetHost,
            remotePort: targetPort
          };
          this.isConnected = true;
          settled = true;
          resolve(this.tunnelInfo);
        } catch (error) {
          await this.disconnect();
          settled = true;
          reject(new Error(`SSH forward failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      });

      sshClient.on('error', (err) => {
        this.isConnected = false;
        if (!settled) {
          settled = true;
          reject(new Error(`SSH connection error: ${err.message}`));
        }
      });

      sshClient.on('close', () => {
        this.isConnected = false;
        if (this.localServer) {
          this.localServer.close();
          this.localServer = null;
        }
        this.tunnelInfo = null;
      });

      sshClient.connect(connectConfig);
    });
  }

  private async startLocalForwardServer(
    sshClient: Client,
    targetHost: string,
    targetPort: number
  ): Promise<number> {
    const server = createServer((socket) => {
      if (!this.isConnected) {
        socket.destroy();
        return;
      }

      sshClient.forwardOut(
        socket.localAddress || '127.0.0.1',
        socket.localPort || 0,
        targetHost,
        targetPort,
        (err, stream) => {
          if (err) {
            socket.destroy(new Error(`SSH forwardOut failed: ${err.message}`));
            return;
          }

          socket.pipe(stream).pipe(socket);
          socket.on('error', () => stream.destroy());
          stream.on('error', () => socket.destroy());
        }
      );
    });

    this.localServer = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine local forwarding port');
    }

    return address.port;
  }

  async disconnect(): Promise<void> {
    if (this.localServer) {
      await new Promise<void>((resolve) => {
        this.localServer!.close(() => resolve());
      });
      this.localServer = null;
    }

    if (this.sshClient) {
      const client = this.sshClient;
      this.sshClient = null;
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        client.once('close', done);
        client.end();
        setTimeout(done, 1000);
      });
    }

    this.tunnelInfo = null;
    this.isConnected = false;
  }

  getTunnelInfo(): TunnelInfo | null {
    return this.tunnelInfo;
  }

  isActive(): boolean {
    return this.isConnected && this.sshClient !== null && this.localServer !== null;
  }

  private async closeLocalServer(): Promise<void> {
    if (!this.localServer) {
      return;
    }

    const server = this.localServer;
    this.localServer = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

export class SSHTunnelManager {
  private static instance: SSHTunnelManager;
  private tunnels: Map<string, SSHTunnel> = new Map();

  static getInstance(): SSHTunnelManager {
    if (!SSHTunnelManager.instance) {
      SSHTunnelManager.instance = new SSHTunnelManager();
    }
    return SSHTunnelManager.instance;
  }

  async createTunnel(
    connectionId: string,
    sshConfig: SSHConfig,
    targetHost: string,
    targetPort: number
  ): Promise<TunnelInfo> {
    let tunnel = this.tunnels.get(connectionId);
    
    if (tunnel && tunnel.isActive()) {
      const info = tunnel.getTunnelInfo();
      if (info && info.remoteHost === targetHost && info.remotePort === targetPort) {
        return info;
      }
      await tunnel.disconnect();
    }

    tunnel = new SSHTunnel();
    const tunnelInfo = await tunnel.connect(sshConfig, targetHost, targetPort);
    this.tunnels.set(connectionId, tunnel);
    
    return tunnelInfo;
  }

  async closeTunnel(connectionId: string): Promise<void> {
    const tunnel = this.tunnels.get(connectionId);
    if (tunnel) {
      await tunnel.disconnect();
      this.tunnels.delete(connectionId);
    }
  }

  getTunnel(connectionId: string): SSHTunnel | undefined {
    return this.tunnels.get(connectionId);
  }

  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.tunnels.keys()).map(id => this.closeTunnel(id));
    await Promise.all(closePromises);
  }
}
