import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import { ClientVisaGroup } from "./client-visa-group.entity";

@Entity("clients")
@Index(["isResident", "queueIndex"])
@Index(["isResident", "isActive", "queueIndex"])
export class Client {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @OneToMany(() => ClientVisaGroup, (visaGroup) => visaGroup.client)
  visaGroups: ClientVisaGroup[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isResident: boolean;

  @Column({ nullable: true })
  companyEmail: string;

  @Column({ name: "queue_index", type: "integer", nullable: true })
  queueIndex: number | null;

  @Column({ name: "last_processed_at", type: "timestamp", nullable: true })
  lastProcessedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

