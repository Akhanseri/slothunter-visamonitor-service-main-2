import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("visa_logs")
@Index(["parserEmail", "checkedAt"])
@Index(["city", "appointmentDate"])
export class VisaLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  parserEmail: string;

  @Column({ type: "boolean", default: false })
  isResident: boolean;

  @Column()
  city: string;

  @Column({ type: "date" })
  appointmentDate: string;

  @Column("simple-array")
  availableTimes: string[];

  @CreateDateColumn()
  checkedAt: Date;
}

