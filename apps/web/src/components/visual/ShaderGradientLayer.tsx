import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react';
import { shaderCanvasProps, shaderGradientProps } from './shader-gradient-config';

export default function ShaderGradientLayer({ animate }: { animate: boolean }) {
  return (
    <ShaderGradientCanvas
      style={{ position: 'absolute', inset: 0 }}
      pointerEvents="none"
      pixelDensity={shaderCanvasProps.pixelDensity}
      fov={shaderCanvasProps.fov}
      lazyLoad={false}
      powerPreference="low-power"
    >
      <ShaderGradient control="props" {...shaderGradientProps} animate={animate ? 'on' : 'off'} />
    </ShaderGradientCanvas>
  );
}
