import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DownloadPurpose, LicenseGrantStatus } from '../types/enums';

export type LicenseGrantDocument = HydratedDocument<LicenseGrant>;

@Schema({ timestamps: true })
export class LicenseGrant {
  @Prop({ type: Types.ObjectId, ref: 'Asset', required: true })
  assetId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true })
  granteeId!: string;

  @Prop({ required: true })
  issuedBy!: string;

  @Prop({ enum: DownloadPurpose, required: true })
  purpose!: DownloadPurpose;

  @Prop({ required: true })
  licenseVersion!: string;

  @Prop({ enum: LicenseGrantStatus, default: LicenseGrantStatus.Active })
  status!: LicenseGrantStatus;

  @Prop({ default: () => new Date() })
  issuedAt!: Date;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  usedAt?: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  revokedBy?: string;
}

export const LicenseGrantSchema = SchemaFactory.createForClass(LicenseGrant);
// 同一素材对同一被授权人最多存在一条 Active 许可，从数据库层杜绝重复/并发签发的双重生效
LicenseGrantSchema.index(
  { assetId: 1, granteeId: 1 },
  { unique: true, partialFilterExpression: { status: LicenseGrantStatus.Active } },
);
