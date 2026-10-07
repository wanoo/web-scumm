// The part of `ssh2` (MIT, pure JavaScript) the SSH connector and its tests use (4.1.9). Written here rather than
// taking `@types/ssh2`, which pins an older `@types/node` beside the repository's.
declare module 'ssh2' {
  import type { EventEmitter } from 'node:events';
  import type { Duplex } from 'node:stream';

  interface ParsedKey {
    type: string;
    getPublicSSH(): Buffer;
    verify(data: Buffer, signature: Buffer, hashAlgo?: string): boolean | Error;
  }
  interface AuthContext {
    method: 'none' | 'password' | 'publickey' | 'keyboard-interactive' | 'hostbased';
    username: string;
    password?: string;
    key?: { algo: string; data: Buffer };
    signature?: Buffer;
    blob?: Buffer;
    hashAlgo?: string;
    accept(): void;
    reject(methods?: string[], partial?: boolean): void;
  }
  interface ServerChannel extends Duplex {
    stderr: Duplex;
    exit(code: number): void;
    close(): void;
  }
  type Accept<T = void> = () => T;
  type Reject = () => void;
  interface Session extends EventEmitter {
    on(
      event: 'pty',
      l: (accept: Accept, reject: Reject, info: { cols: number; rows: number; term: string }) => void,
    ): this;
    on(event: 'window-change', l: (accept: Accept, reject: Reject, info: { cols: number; rows: number }) => void): this;
    on(event: 'shell', l: (accept: Accept<ServerChannel>, reject: Reject) => void): this;
    on(
      event: 'exec' | 'subsystem' | 'env' | 'x11' | 'auth-agent' | 'signal',
      l: (accept: Accept, reject: Reject) => void,
    ): this;
    on(event: 'close', l: () => void): this;
  }
  interface Connection extends EventEmitter {
    on(event: 'authentication', l: (ctx: AuthContext) => void): this;
    on(event: 'ready' | 'close' | 'end', l: () => void): this;
    on(event: 'error', l: (e: Error) => void): this;
    on(event: 'session', l: (accept: Accept<Session>, reject: Reject) => void): this;
    on(event: 'tcpip' | 'openssh.streamlocal', l: (accept: Accept, reject: Reject) => void): this;
    on(event: 'request', l: (accept: Accept | undefined, reject: Reject | undefined, name: string) => void): this;
    end(): void;
  }
  class Server extends EventEmitter {
    constructor(
      config: { hostKeys: (Buffer | string)[]; ident?: string; banner?: string; keepaliveInterval?: number },
      listener?: (client: Connection, info: { ip: string }) => void,
    );
    maxConnections: number;
    listen(port: number, host: string, cb?: () => void): this;
    address(): { port: number } | string | null;
    close(cb?: () => void): this;
  }
  interface ClientChannel extends Duplex {
    setWindow(rows: number, cols: number, height: number, width: number): void;
  }
  class Client extends EventEmitter {
    connect(config: {
      host: string;
      port: number;
      username: string;
      password?: string;
      privateKey?: Buffer | string;
      readyTimeout?: number;
      tryKeyboard?: boolean;
    }): this;
    shell(
      opts: { cols?: number; rows?: number; term?: string } | false,
      cb: (err: Error | undefined, stream: ClientChannel) => void,
    ): this;
    exec(cmd: string, cb: (err: Error | undefined, stream: ClientChannel) => void): this;
    sftp(cb: (err: Error | undefined) => void): this;
    forwardOut(
      srcIP: string,
      srcPort: number,
      dstIP: string,
      dstPort: number,
      cb: (err: Error | undefined) => void,
    ): this;
    end(): this;
  }
  const utils: {
    parseKey(data: string | Buffer): ParsedKey | ParsedKey[] | Error;
    generateKeyPairSync(
      type: 'ed25519' | 'ecdsa' | 'rsa',
      opts?: { bits?: number },
    ): { private: string; public: string };
  };
  export { AuthContext, Client, ClientChannel, Connection, ParsedKey, Server, ServerChannel, Session, utils };
  const ssh2: { Client: typeof Client; Server: typeof Server; utils: typeof utils };
  export default ssh2;
}
