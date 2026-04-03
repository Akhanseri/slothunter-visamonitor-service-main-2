import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Client } from "./client.entity";

@Entity("client_sessions")
@Index(["clientId", "scheduleId"], { unique: true })
@Index(["expiresAt"])
export class ClientSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "client_id" })
  clientId: number;

  @ManyToOne(() => Client, { onDelete: "CASCADE" })
  @JoinColumn({ name: "client_id" })
  client: Client;

  @Column({ name: "schedule_id" })
  scheduleId: string;

  // Encrypted (AES-256-GCM) strings, format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
  @Column({ name: "cookie_enc", type: "text" })
  cookieEnc: string;

  @Column({ name: "csrf_enc", type: "text" })
  csrfEnc: string;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}


