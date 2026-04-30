import { NextRequest, NextResponse } from 'next/server';
import { getProduct, updateProduct, archiveProduct } from '@/lib/autopilot/products';
import { preflightRepoAccess } from '@/lib/repo-preflight';
import { UpdateProductSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const product = getProduct(id);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(product);
  } catch (error) {
    console.error('Failed to fetch product:', error);
    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validation = UpdateProductSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: validation.error.issues }, { status: 400 });
    }
    const existing = getProduct(id);
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const {
      repo_access_confirmed: repoAccessConfirmed,
      repo_branch_confirmed: repoBranchConfirmed,
      ...updates
    } = validation.data;

    const nextRepoUrl = updates.repo_url !== undefined ? updates.repo_url : existing.repo_url;
    const nextBranch = updates.default_branch || existing.default_branch || 'main';

    if (nextRepoUrl) {
      const preflight = preflightRepoAccess(nextRepoUrl, nextBranch);
      if (!preflight.ok) {
        return NextResponse.json({
          error: preflight.access === 'failed'
            ? 'Repository access must be confirmed before saving this Autopilot product.'
            : 'Selected repository branch was not found.',
          repo_preflight: preflight,
        }, { status: 400 });
      }

      const repoChanged = updates.repo_url !== undefined && updates.repo_url !== existing.repo_url;
      const branchChanged = updates.default_branch !== undefined && updates.default_branch !== existing.default_branch;
      if ((repoChanged || branchChanged) && (!repoAccessConfirmed || !repoBranchConfirmed)) {
        return NextResponse.json({
          error: 'Confirm repository access and branch before saving repository changes.',
          repo_preflight: preflight,
        }, { status: 400 });
      }

      updates.default_branch = preflight.resolvedBranch || nextBranch;
    }

    const product = updateProduct(id, updates);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(product);
  } catch (error) {
    console.error('Failed to update product:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = archiveProduct(id);
    if (!deleted) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to archive product:', error);
    return NextResponse.json({ error: 'Failed to archive product' }, { status: 500 });
  }
}
