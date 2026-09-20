import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LICENSE_ROUTES } from '../routes/license.routes';
import { LicenseService } from '../services/license.service';
import { DownloadPurpose, LicenseGrantStatus } from '../types/enums';
import type { AuthUser } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('licenses')
@Controller()
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get(LICENSE_ROUTES.root)
  async findAll(
    @Query('assetId') assetId?: string,
    @Query('code') code?: string,
    @Query('status') status?: LicenseGrantStatus,
  ) {
    return ok(await this.licenseService.findAll({ assetId, code, status }));
  }

  @Get(LICENSE_ROUTES.byCode)
  async findByCode(@Param('code') code: string) {
    return ok(await this.licenseService.findByCode(code));
  }

  @Post(LICENSE_ROUTES.issueForAsset)
  async issue(
    @Param('assetId') assetId: string,
    @Req() req: Request & { user?: AuthUser },
    @Body('purpose') purpose: DownloadPurpose = DownloadPurpose.Commercial,
    @Body('granteeId') granteeId?: string,
  ) {
    const user = req.user ?? { id: 'anonymous', role: undefined as never };
    return ok(await this.licenseService.issue(assetId, user, purpose, granteeId), '许可已签发');
  }

  @Post(LICENSE_ROUTES.revoke)
  async revoke(@Param('code') code: string, @Req() req: Request & { user?: AuthUser }) {
    const user = req.user ?? { id: 'anonymous', role: undefined as never };
    return ok(await this.licenseService.revoke(code, user), '许可已撤销');
  }
}
