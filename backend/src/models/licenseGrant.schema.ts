import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DownloadPurpose, LicenseStatus } from '../types/enums';

export type LicenseGrantDocument = HydratedDocument<LicenseGrant>;

@Schema({ timestamps: true })
export class LicenseGrant {
  @Prop({ type: Types.ObjectId, ref: 'Asset', required: true })
  assetId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true })
  grantedTo!: string;

  @Prop({ required: true })
  grantedBy!: string;

  @Prop({ enum: DownloadPurpose, required: true })
  purpose!: DownloadPurpose;

  @Prop({ enum: LicenseStatus, default: LicenseStatus.Active })
  status!: LicenseStatus;

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
// 同一素材对同一被授权人最多存在一条 Active 许可，防止重复/并发签发双重生效
LicenseGrantSchema.index(
  { assetId: 1, grantedTo: 1 },
  { unique: true, partialFilterExpression: { status: LicenseStatus.Active } },
);
LicenseGrantSchema.index({ expiresAt: 1 });
