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
import { MatchStatus, MatchStatusType } from "../enums/match-status.enum";
import { VisaGroupStatus } from "../enums/visa-group.enum";

@Entity("client_visa_groups")
@Index(["clientId"])
@Index(["matchStatus"])
@Index(["candidateSlotExpiresAt"])
@Index(["isActive"])
export class ClientVisaGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "client_id" })
  clientId: number;

  @ManyToOne(() => Client, (client) => client.visaGroups, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "client_id" })
  client: Client;

  @Column({
    type: "enum",
    enum: VisaGroupStatus,
  })
  status: VisaGroupStatus;

  @Column({ name: "schedule_path" })
  schedulePath: string;

  @Column({ nullable: true })
  city: string | null;

  @Column({ name: "slot_start_date", nullable: true })
  slotStartDate: string | null;

  @Column({ name: "slot_end_date", nullable: true })
  slotEndDate: string | null;

  @Column({ name: "delay_days", type: "int", nullable: true })
  delayDays: number | null;

  @Column({
    name: "match_status",
    type: "enum",
    enum: MatchStatus,
    nullable: true,
  })
  matchStatus: MatchStatusType | null;

  @Column({ name: "candidate_slot", nullable: true, type: "jsonb" })
  candidateSlot: {
    date: string;
    time: string;
    city: string;
  } | null;

  @Column({
    name: "candidate_slot_expires_at",
    nullable: true,
    type: "timestamp",
  })
  candidateSlotExpiresAt: Date | null;

  @Column({ name: "last_notified_at", nullable: true, type: "timestamp" })
  lastNotifiedAt: Date | null;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @Column({ name: "is_auto_book_enabled", default: false })
  isAutoBookEnabled: boolean;

  @Column({ name: "applicants_count", type: "int", nullable: true })
  applicantsCount: number | null;

  @Column({ name: "applicants", nullable: true, type: "jsonb" })
  applicants: Array<{
    ivrNumber: string;
    name: string;
  }> | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}

