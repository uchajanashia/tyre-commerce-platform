const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {PrismaClient}=require('@prisma/client');
const bcrypt=require('bcrypt');
process.loadEnvFile(resolve(__dirname,'../apps/api/.env'));
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/tyre_demo'||process.env.APP_ENV!=='development')throw new Error('Synthetic seed only runs against the named local demo database.');
if(!process.env.DEMO_ADMIN_PASSWORD)throw new Error('Generate the local demo environment first.');
const prisma=new PrismaClient();
async function main(){
 const fixtures=JSON.parse(readFileSync(resolve(__dirname,'../apps/website/src/assets/data/tires.json'),'utf8'));
 const brands=JSON.parse(readFileSync(resolve(__dirname,'../apps/website/src/assets/data/brands.json'),'utf8'));
 for(const b of brands)await prisma.brand.upsert({where:{id:b.id},update:{},create:{id:b.id,name:b.name,notes:'Synthetic portfolio fixture'}});
 for(const t of fixtures){
  const slug=t.model.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const model=await prisma.tireModel.upsert({where:{brandId_slug:{brandId:t.brandId,slug}},update:{},create:{brandId:t.brandId,slug,name:t.model}});
  await prisma.product.upsert({where:{id:t.id},update:{},create:{id:t.id,code:t.id,slug:t.id,productType:'tire',vehicleClass:'passenger',vehicleClassification:'sedan',brandId:t.brandId,patternKey:slug,tireModelId:model.id,size:`${t.size.widthMm}/${t.size.aspect}R${t.size.rimDiameterInch}`,width:t.size.widthMm,profile:t.size.aspect,rimDiameter:t.size.rimDiameterInch,radius:`R-${t.size.rimDiameterInch}`,construction:'radial',commercial:false,application:'Synthetic passenger tyre',season:t.season==='summer'?'ზაფხული':t.season==='winter'?'M+S':'ყველა სეზონი',seasonGroup:t.season.replace('-','_'),unit:'piece',retailPrice:t.priceGel,wholesalePrice:t.priceGel,stockStatus:t.inStock?'in_stock':'out_of_stock',stockQty:t.inStock,name:`${t.brandId} ${t.model}`,isPublished:true}});
 }
 const admin=await prisma.admin.upsert({where:{email:'admin@example.invalid'},update:{},create:{email:'admin@example.invalid',emailNormalized:'admin@example.invalid',displayName:'Synthetic local administrator',passwordHash:await bcrypt.hash(process.env.DEMO_ADMIN_PASSWORD,12),enabled:true,status:'active',role:'admin'}});
 await prisma.role.upsert({where:{id:'portfolio-admin'},update:{},create:{id:'portfolio-admin',key:'portfolio-admin',name:'Local demo admin',isSystem:false}});
 await prisma.permission.upsert({where:{key:'*'},update:{},create:{id:'portfolio-wildcard',key:'*',description:'Local synthetic demo only'}});
 const permission=await prisma.permission.findUniqueOrThrow({where:{key:'*'}});
 await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:'portfolio-admin',permissionId:permission.id}},update:{},create:{roleId:'portfolio-admin',permissionId:permission.id}});
 await prisma.adminRoleAssignment.upsert({where:{id:'portfolio-admin-grant'},update:{},create:{id:'portfolio-admin-grant',adminId:admin.id,roleId:'portfolio-admin',scopeType:'global',scopeId:''}});
 console.log(`Seeded ${fixtures.length} synthetic products and one local administrator. Password stays in your ignored .env.`);
}
main().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[database URL redacted]'));process.exitCode=1;}).finally(()=>prisma.$disconnect());
