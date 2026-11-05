const GREEN = '#25855a'

export function LogoIcon({ size = 32 }) {
  return (
    <svg viewBox="19 -12 74 74" width={size} height={size} role="img" aria-label="VeloDesk">
      <path fill="currentColor" d="M 21.358301,0 37.900731,0.51822138 q 2.60218,0.37016 2.60218,1.25853002 -0.18587,0.59226 -2.60218,0.81435 l -10.22285,1.4066 h -2.97392 l -3.34566,-2.66513 q -0.65055,-0.88838002 0,-1.3325700225105 z" />
      <path fill="currentColor" d="m 38.822741,37.843742 h -3.84227 l -7.22689,-33.1763406 4.94006,0.0273 6.678,25.0055606 19.76024,-17.76755 h 9.00189 z" />
      <path fill={GREEN} fillRule="evenodd" d="m 59.432721,49.209792 0.0548,-27.84149 7.19832,-6.68107 6.94692,-0.0774 c 9.55393,-0.10651 17.29999,7.74547 17.29999,17.3 0,9.55452 -7.74546,17.3 -17.29999,17.3 z m 5.3,-29.6 v 25 h 8.9 c 6.90356,0 12.49999,-5.59644 12.49999,-12.5 0,-6.90356 -5.59643,-12.5 -12.49999,-12.5 z" />
      <path fill="currentColor" d="M 35.749829,12.999011 71.214831,6.6038436 69.49934,10.333878 Z" />
      <path fill="currentColor" d="m 73.896541,32.015312 -7.0329,-23.3693506 4.05623,-0.60848 4.39953,23.7570306 z" />
      <path fill="none" stroke="currentColor" strokeWidth="3.12567" strokeLinecap="round" strokeLinejoin="round" d="m 68.980521,7.1505314 h 6.78425 q 3.06686,0 3.25273,1.85078 -0.18587,1.6286906 -4.18208,2.3690106" />
    </svg>
  )
}

export default function Logo({ size = 40 }) {
  return (
    <>
      <LogoIcon size={size} />
      <span className="logo-wordmark">Velo<span>Desk</span></span>
    </>
  )
}