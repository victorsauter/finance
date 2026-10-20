# Deploy Finance on Kubernetes

Build the static frontend into a non-root Nginx container listening on port 8080.
Browser data stays in IndexedDB until an API and server database are added.

## Prerequisites

Use an active worker node, a local kubeconfig, a container registry, an Ingress
controller with class `nginx`, cert-manager and a `letsencrypt-production`
ClusterIssuer. Keep the kubeconfig and credentials outside Git.

## Build and publish

Build for your worker architecture (this example uses x86):

```bash
docker build --platform linux/amd64 --pull -t your-registry.example/finance:0.1.0 .
docker push your-registry.example/finance:0.1.0
```

Replace the image path and tag in the production Kustomize overlay. Configure
imagePullSecrets on the Deployment if your registry is private.

## Configure HTTPS and deploy

Replace both example hostnames in the production Ingress. Install your Ingress
controller and cert-manager, then replace the email address in a local copy of
the ClusterIssuer template before applying it. Point your domain's DNS at the
Ingress public address before requesting a certificate.

```bash
kubectl kustomize k8s/overlays/production
kubectl apply -k k8s/overlays/production
kubectl rollout status deployment/finance --namespace finance
kubectl get ingress --namespace finance
```

For updates, publish a new immutable image tag, update the overlay and repeat
the apply and rollout commands. Worker nodes, networking, storage and backups
are billed separately from the shared control plane.

## Future database

Add an authenticated API for synchronisation. Keep PostgreSQL private, use a
persistent volume and encrypted backups, and keep database credentials outside Git.
