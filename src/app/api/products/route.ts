import { NextRequest, NextResponse } from 'next/server';
import { createProduct, listProducts } from '@/lib/autopilot/products';
import { preflightRepoAccess } from '@/lib/repo-preflight';
import { CreateProductSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id') || undefined;
    const products = listProducts(workspaceId);
    return NextResponse.json(products);
  } catch (error) {
    console.error('Failed to list products:', error);
    return NextResponse.json({ error: 'Failed to list products' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = CreateProductSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: validation.error.issues }, { status: 400 });
    }
    const {
      repo_access_confirmed: repoAccessConfirmed,
      repo_branch_confirmed: repoBranchConfirmed,
      ...productInput
    } = validation.data;

    if (productInput.repo_url) {
      const preflight = preflightRepoAccess(productInput.repo_url, productInput.default_branch || 'main');
      if (!preflight.ok) {
        return NextResponse.json({
          error: preflight.access === 'failed'
            ? 'Repository access must be confirmed before creating an Autopilot product.'
            : 'Selected repository branch was not found.',
          repo_preflight: preflight,
        }, { status: 400 });
      }
      if (!repoAccessConfirmed || !repoBranchConfirmed) {
        return NextResponse.json({
          error: 'Confirm repository access and branch before creating an Autopilot product.',
          repo_preflight: preflight,
        }, { status: 400 });
      }
      productInput.default_branch = preflight.resolvedBranch || productInput.default_branch || 'main';
    }

    const product = createProduct(productInput);
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error('Failed to create product:', error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
