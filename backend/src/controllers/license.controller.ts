import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LICENSE_ROUTES } from '../routes/license.routes';
import { LicenseService } from '../services/license.service';
import { DownloadPurpose, LicenseStatus } from '../types/enums';
import type { AuthUser } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('licenses')
@Controller()
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get(LICENSE_ROUTES.root)
  async findAll(@Query() query: { assetId?: string; grantedTo?: string; status?: LicenseStatus }) {
    return ok(await this.licenseService.findAll(query));
  }

  @Get(LICENSE_ROUTES.byCode)
  async findOne(@Param('code') code: string) {
    return ok(await this.licenseService.findByCode(code));
  }

  @Post(LICENSE_ROUTES.issue)
  async issue(
    @Param('assetId') assetId: string,
    @Req() req: Request & { user?: AuthUser },
    @Body() body: { grantedTo?: string; purpose?: DownloadPurpose } = {},
  ) {
    return ok(await this.licenseService.issue(assetId, req.user ?? { id: 'anonymous', role: undefined as never }, body ?? {}), '许可已签发');
  }

  @Post(LICENSE_ROUTES.revoke)
  async revoke(@Param('code') code: string, @Req() req: Request & { user?: AuthUser }) {
    return ok(await this.licenseService.revoke(code, req.user ?? { id: 'anonymous', role: undefined as never }), '许可已撤销');
  }
}
