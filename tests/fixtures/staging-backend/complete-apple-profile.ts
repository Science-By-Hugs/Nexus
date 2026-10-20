import { runtimeKeys,serveStaging } from '../_shared/staging.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.1';
serveStaging(async req=>{
 const authorization=req.headers.get('authorization')!;
 const userClient=createClient(Deno.env.get('SUPABASE_URL')!,JSON.parse(runtimeKeys('publishable')).default,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await userClient.auth.getUser();
 if(error||!user)return Response.json({error:'Sign in required'},{status:401});
 if(!user.email || !user.email_confirmed_at || user.app_metadata.synthetic!==true || user.app_metadata.environment!=='staging' || !user.identities?.some(identity=>identity.provider==='apple'))return Response.json({error:'Approved staging Apple identity required'},{status:403});
 const body=await req.json();
 if(typeof body.firstName!=='string'||typeof body.lastName!=='string')return Response.json({error:'Enter your first and last name.'},{status:400});
 const first=body.firstName.trim(),last=body.lastName.trim();
 if(!first||!last||first.length>80||last.length>80)return Response.json({error:'Enter your first and last name.'},{status:400});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,JSON.parse(runtimeKeys('secret')).default,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await admin.rpc('provision_apple_profile',{p_user_id:user.id,p_verified_email:user.email,p_first_name:first,p_last_name:last});
 if(result.error)return Response.json({error:'Your account could not be set up. If you already have a customer account, sign in to it and connect Apple from Account settings.'},{status:409});
 const profile=Array.isArray(result.data)?result.data[0]:result.data;
 if(!profile?.id)return Response.json({error:'Profile setup could not be confirmed.'},{status:500});
 return Response.json({success:true,profile:{id:profile.id,customer_number:profile.customer_number}});
});
